# Operations

Day-two work: keeping the instance healthy, moving credentials, and getting out
of trouble. Deployment mechanics live in [deployment](deployment.md); the board's
own semantics live in [superboard](superboard.md). Named backup agents and
their offline restore procedure live in [backup-agent](backup-agent.md).

## Health checks

| Check         | Command / endpoint                                        | Healthy means                                                                                                                         |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Containers    | `sudo docker compose ps` (from the install directory)     | `caddy`, `backend` and `web` all `healthy`, low restart counts.                                                                       |
| Backend alive | `GET /healthz` (no token; Caddy routes it to the backend) | 200 `{"status":"ok"}`: database answers within 2 s and the check engine's watchdog ticked within 30 s. 503 with a `reason` otherwise. |
| Web app alive | `GET /build` (no token)                                   | 200 `{"build":"<id>"}`: the Next.js server answers; the id is the deployed build.                                                     |
| Fleet summary | `GET /api/v1/health` (token)                              | `total` matches the expected count, `down` matches reality; 503 when the database fails.                                              |
| Public origin | `curl -o /dev/null -w '%{http_code}' https://<origin>/`   | 200 from the public origin (through whatever tunnel or proxy fronts it).                                                              |
| Agents        | newest telemetry per push monitor                         | seconds old, not minutes.                                                                                                             |
| Local dev     | `./dev.sh status`                                         | backend 200, web 200.                                                                                                                 |

The board itself is the best health signal: a fleet-wide problem shows as a
wall of stale cards, and `Agent: …` lines surface the host-side cause.

### Watching the watcher

The backend's healthcheck probes `/healthz` every 30 s (the web container's
probes `/build`), but Docker only _marks_
an unhealthy container; it never restarts it, and nothing inside the stack can
report that the stack itself is down. Something outside has to watch it:

- **Off-host check (required).** From a machine that is not the KoreMonitor
  host, probe the public origin every minute and alert when it fails: a
  healthchecks.io/uptime service HTTP check on `https://<origin>/healthz`, an
  HTTP monitor in another KoreMonitor instance, or a cron/systemd-timer job:

  ```bash
  # crontab on another host: alert after a failed probe (5 s timeout).
  * * * * * curl -fsS -m 5 -o /dev/null https://monitor.example.com/healthz \
      || curl -fsS -m 10 -o /dev/null "https://api.telegram.org/bot<bot>/sendMessage?chat_id=<chat>&text=KoreMonitor+healthz+failing"
  ```

  This catches everything the instance cannot report about itself: host down,
  tunnel down, the backend wedged with a dead database or a stalled engine.
  `/healthz` passes through Caddy but not the web app; probe
  `https://<origin>/build` the same way to cover it.

- **On-host restart (optional).** If an unhealthy container should restart
  itself, a root cron entry is enough (run it from the directory that holds
  `compose.yaml`, so the project resolves):

  ```bash
  */5 * * * * cd /opt/koremonitor && for c in $(docker compose ps -q backend web); do [ "$(docker inspect -f '{{.State.Health.Status}}' $c)" = unhealthy ] && docker restart $c; done
  ```

  The web app has its own healthcheck (`GET /build`); a hung web app leaves
  `/healthz` green, which is why both containers are in the loop.

  Keep the off-host check regardless: a restart loop is still an outage.

## Backups

Backups come from three places:

| What                            | Where                                                   | By                                                                  |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| KoreMonitor's own database      | `/srv/koremonitor-backups/nightly` (14 daily, 8 weekly) | `koremonitor-backup.timer`, 03:30 host time (below)                 |
| Application data (Postgres, S3) | `/srv/koremonitor-backups/agents` (7 per agent)         | Backup agents on the source hosts ([backup-agent](backup-agent.md)) |
| Pre-release database copies     | `/opt/koremonitor/backups/`                             | The release procedure ([deployment](deployment.md))                 |

Put the backup directory on a redundant disk (RAID1 or a second disk): that
survives a failed disk, not a fire or theft. No off-site copy is configured
by default (`OFFSITE_TARGET` below covers the nightly database only).

The database is a single SQLite file. Copy it with the **backup API**, never with
`cp` while the stack is running (a live copy can catch a torn write).

### Nightly backups

`docker/backup/` holds a small, self-contained nightly backup: a script plus a
systemd timer for the server. It protects KoreMonitor's own database (the
[backup agent](backup-agent.md) is a different thing: it ships application
data, such as Postgres and object storage, from other hosts to this one), and
it deliberately does one thing: every night it copies the live database
through the SQLite backup API over a read-only connection (the container keeps
running), refuses the copy unless `PRAGMA integrity_check` says `ok`, stores it
gzip'd, keeps **14 daily and 8 weekly** copies, and optionally mirrors the
backup directory off-host with rsync or rclone (skipped while no target is set).

Install, once, as root from the source tree:

```bash
sudo install -m 0755 docker/backup/koremonitor-backup.sh /usr/local/sbin/koremonitor-backup
sudo install -m 0644 docker/backup/koremonitor-backup.service docker/backup/koremonitor-backup.timer /etc/systemd/system/
sudo install -m 0600 docker/backup/koremonitor-backup.env.example /etc/koremonitor-backup.env   # edit as needed
sudo systemctl daemon-reload
sudo systemctl enable --now koremonitor-backup.timer

# Run it once now and read the result.
sudo systemctl start koremonitor-backup.service
journalctl -u koremonitor-backup -n 20
ls -l /opt/koremonitor/backups/nightly/daily/
```

- Defaults: database `/opt/koremonitor/data/koremonitor.db`, backups in
  `/opt/koremonitor/backups/nightly/{daily,weekly}`, 03:30 (± 15 min), a run
  missed while the host was off happens at the next boot. Everything is
  overridable in `/etc/koremonitor-backup.env` (see the example file).
- **Put the backup directory on a different disk** from the live database: set
  `BACKUP_DIR` in `/etc/koremonitor-backup.env`, for example to a redundant
  `/srv/koremonitor-backups/nightly`. A nightly copy on the same disk as the
  database does not survive that disk failing.
- **Off-host copy:** set `OFFSITE_TARGET` (and `OFFSITE_TOOL=rsync|rclone`). The
  directory is mirrored with deletions, so the remote follows the rotation.
  This is the copy that survives losing the server itself; set it.
- `NOTIFY_URL`, if set, is fetched after every successful run: point it at a
  dead-man's-switch check (healthchecks.io, or a push monitor on another
  instance) so a backup that silently stops running is noticed.
- A failed run (integrity check, missing tool, unreachable target) exits
  non-zero, so `systemctl --failed` and the journal show it.
- Restoring from a nightly: `gunzip -c <file>.db.gz > koremonitor.db`, then follow
  the restore steps below.
- Updating the script after a change in the repository: repeat the `install`
  lines; the timer keeps running.

### By hand

Before a release (see [deployment](deployment.md#releasing)) or whenever a copy
is needed right now:

```bash
BM=/opt/koremonitor/backups/koremonitor-$(date -u +%Y%m%d-%H%M%S).db
python3 - "$BM" <<'PY'
import sqlite3, sys
live = sqlite3.connect("file:/opt/koremonitor/data/koremonitor.db?mode=ro", uri=True)
copy = sqlite3.connect(sys.argv[1])
with copy:
    live.backup(copy)
print("integrity:", copy.execute("PRAGMA integrity_check").fetchone()[0])
PY
chmod 600 "$BM"
```

- Take one **before every release**, right before the recreate, and keep it — a
  rollback generally needs it. The nightly copies do not replace it: they can be
  up to a day old.
- `PRAGMA integrity_check` on the copy must print `ok`; a backup you have not
  verified is not a backup.
- Backups are as sensitive as the live database: they contain tokens, incident
  text and the status-page password hashes. Keep them root-only and out of Git.
- Verify a restore by pointing a throwaway backend at the copy, not by restoring
  over production first (`DATA_DIR=<dir> PORT=3101 koremonitor-backend`).

Restoring: stop the stack, replace `data/koremonitor.db` (and delete its
`-wal`/`-shm` siblings), start the stack. A file restored by root is fine: the
container's entrypoint hands anything in the data directory back to its
`koremonitor` user (uid 10001) on start. See
[deployment](deployment.md#rolling-back) for the paired image step.

## Accounts

People sign in to the web app **only through Kore ID**; every account has full
operator access. **Members** (`/members`) lists the accounts Kore ID
provisioned, and lets someone signed in remove one. There is no add-with-
password, no password reset and no change-password page.

- **Give someone access:** grant them the `flatline` app in Kore ID's admin.
  Their first sign-in provisions a full operator account.
- **Someone leaves:** remove the app (or disable the user) in Kore ID, then
  remove them on **Members**; leave their tokens ticked in the remove dialog so
  the tokens they made are revoked with them.
- **Nobody can sign in:** check `KORE_ID_ISSUER`, the client secret and the
  redirect URI in `.env`, then sign in through Kore ID again. There is no
  operator-token or first-account fallback. The backend still boots without
  Kore ID, but its sign-in page says no sign-in method is configured.
- **A fresh install:** the first Kore ID sign-in becomes the first operator;
  there is no seed script or initial token file.
- **An old password account:** it links to Kore ID by verified email on its
  first SSO sign-in; its password hash is overwritten.

## Tokens

There are three credential families, told apart by prefix. Operator API
tokens (`kmon_op_`) are full-permission bearers for `/api/v1`; they never
sign in a browser. Push-agent tokens (`kmon_agent_push_`) and backup-agent
tokens (`kmon_agent_backup_`) are agent-scoped and rejected by the operator
API. Nothing is scoped beyond that family boundary, so an operator token is only
as narrow as the person holding it. Tokens minted by earlier releases keep their
old prefix and keep working until rotated.

| Credential         | Where it lives                                         | Rotating it                                                                                                                       |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Operator API token | `tokens` table, hashes only                            | Mint a named token on **Tokens**; disable or delete it to revoke. Plaintext is shown once.                                        |
| Provisioning token | `/opt/koremonitor/provisioning-token.txt` (0600, root) | Disable the key on **Tokens**, mint a replacement, update that file and any shared URL.                                           |
| Push tokens        | `monitors.push_token`, one per agent host              | Rotate in the monitor form (or `PATCH` the monitor), then update `/etc/superboard/config.json` on the host and restart the agent. |
| Backup credentials | `backup_agents.token_hash`, one per agent name         | Rotate through `POST /api/v1/backup-agents/{id}/rotate-token`, then update the agent's token file.                                |
| Backup storage     | `/srv/koremonitor-backups`                             | Enable only with `docker/compose.backups.yaml` after checking the storage marker and free space.                                  |

Rules that keep this manageable:

- One named token per integration. A leak then costs one revoke, not a
  fleet-wide credential change.
- Tokens are bearer credentials: anything holding one _is_ the operator. They do
  not belong in a repository, a ticket, a screenshot or a chat log — which is why
  the provisioning documents are token-gated and Git-ignored paths hold the
  copies on disk.
- If a token does leak, disable it first and rotate second; revocation is
  immediate, including on open SSE streams.
- Push tokens are the exception worth distributing: an agent host holding only a
  push token can report its own monitor and download releases, nothing else. A
  push token used on `/api/v1` answers `agent_token_on_operator_api`, not a
  bare 401.
- Keep the two agent families apart: a backup-agent token only opens
  `/api/backup/v1`, a push-agent token only opens its push route and
  `/agent/*`.

### Restore test for a backup agent

Prove a restore before enabling an agent's daily timer, and again after a
bundle-format change. Run it on a machine you control against the downloaded
bundle, into scratch containers only; never into the live services.

1. Start a scratch `postgres:16` (`POSTGRES_HOST_AUTH_METHOD=trust`) and an
   empty database per source database, and a scratch Garage (single node,
   `replication_factor = 1`, layout assigned) with an empty bucket per source
   bucket and a read/write key; keep files under `/srv/restore-scratch` (not a
   tmpfs).
2. Copy `flatline-backup` out of the running image
   (`/app/backup-agent/flatline-backup-linux-amd64`).
3. Write a `restore-target.json` mapping each source database and bucket to its
   scratch target ([backup-agent](backup-agent.md#recovery)), then run
   `restore` and `compare` against the downloaded bundle (`bundle.tar`, or
   `bundle.age` and add `--identity-file`). On the server the same run sits at
   `/srv/koremonitor-backups/agents/<agent>/<run>/`.
4. Record the result so the dashboard shows it:
   `POST /api/v1/backup-runs/{runId}/verification` with
   `{"kind":"restore","status":"passed","checkedAt":…,"summary":…}`.
5. Remove the scratch containers, their data and images.

Note the agent version the test ran on: a test that fails usually means the
bundle or the restore code is wrong, and the fix needs a re-test.

## Updating the agent fleet

Both agents update themselves from the image. The server ships the telemetry
agent and agents pull it; details and the manual first hop are in
[deployment](deployment.md#agent-versions) and [agent](agent.md). Backup agents
check daily too ([backup-agent](backup-agent.md#self-update)); a host on a
build older than 0.3.0 needs one manual install.

```bash
curl -fsSL '<origin>/agent/install.sh?token=<key>' | sudo bash -s -- --update
```

## Diagnosing

| Symptom                                  | Look at                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A monitor stays pending                  | Agent: `systemctl status superboard`, `journalctl -u superboard -n 50`, `sudo superboard check`. Server: `GET /api/v1/monitors/{id}` for `active` and `pushToken`.                                                                                                                                 |
| A monitor flips down and back            | Network path from that host to the origin, and the monitor's `maxretries`/`retryInterval`. The agent buffers on disk, so short blips arrive late rather than lost.                                                                                                                                 |
| The board is stale but checks work       | SSE: the proxy in front of the app must not buffer responses and must allow idle connections longer than the keepalive. Caddy flushes backend responses as written; anything in front of Caddy must not buffer either.                                                                             |
| Public origin down, containers up        | The proxy or tunnel in front, then the published port (`127.0.0.1:3001`, Caddy): `curl -sS localhost:3001/healthz` reaches the backend, `curl -sS localhost:3001/build` the web app.                                                                                                               |
| Pages fail to load, the API answers      | The web app: `sudo docker compose logs web`. It renders by calling the backend at `API_URL` (`http://backend:3001`); an admin page that cannot reach it says "KoreMonitor may be restarting" and retries on its own.                                                                               |
| Every path answers `502`                 | Caddy cannot reach `backend` or `web` (down or restarting): `sudo docker compose logs caddy`, then the compose `ps` above. Caddy starts even when the backend is down and answers `502` until it is back.                                                                                          |
| Cards show agent warnings                | The tooltip has the per-collector detail and the last push error; right-click → Clear agent warnings once seen. A collector failing forever usually means a host-side tool (driver mismatch, missing `smartctl`).                                                                                  |
| Database growing                         | Expected: heartbeats for `KOREMONITOR_HEARTBEAT_RETENTION_DAYS` (90 by default), 30 days of 30-second metric samples plus two years of hourly rollups. Monitor `du -sh data/`; a sudden jump usually means a monitor was added, not a leak. The `-wal` file is capped at ~64 MB after checkpoints. |
| Agents log `503` from the push endpoint  | The database refused a write (lock timeout, disk full). Agents keep the samples and retry after `Retry-After`; check `df`, then the backend log for the `push:` error. Nothing is lost while the agent buffer has room.                                                                            |
| Container `unhealthy`                    | `curl -sS localhost:3001/healthz` says which part failed (database or engine); then the backend log. Docker will not restart it on its own: see [watching the watcher](#watching-the-watcher).                                                                                                     |
| `/healthz` answers 503                   | The `reason` field: `database error` / `database probe timed out` (lock contention or a full disk), `engine watchdog stalled` (the runtime is wedged; the logs say which loop).                                                                                                                    |
| Alerts arrive as one summary             | Expected under pressure: when four or more alerts wait for one chat, they are coalesced into a single message listing each in order. `notify:` log lines show rate limiting (`429`) and drops.                                                                                                     |
| `engine: … panicked` in the logs         | A check loop crashed and was respawned with backoff; the monitor keeps being checked. Report the message: it is a bug.                                                                                                                                                                             |
| Backend exits at boot: config error      | `PORT` or `KOREMONITOR_HEARTBEAT_RETENTION_DAYS` is set but not a valid number; the message names the variable and value. Fix or unset it.                                                                                                                                                         |
| API answers `503 unavailable`            | The token store could not be read (database locked or failing); clients keep their token and retry. Check the logs for `auth: token store unavailable`.                                                                                                                                            |
| `503 timeout` / `503 busy`               | A request exceeded its 30 s budget or 256 requests were in flight: the database is the usual bottleneck. SSE and agent downloads are not timed.                                                                                                                                                    |
| Status pages or badges answer `429`      | More than 16 public reads in flight (responses are cached 10 s, so this means a flood). Clients are told to retry after 5 s.                                                                                                                                                                       |
| Imported keys answer `429`               | Over 30 failed bcrypt key checks in a minute; wait a minute. Cached keys and already-minted tokens are unaffected.                                                                                                                                                                                 |
| Backend will not start after a downgrade | The database has newer migrations than the binary. Restore the matching backup.                                                                                                                                                                                                                    |

## Logs

| What                    | Where                                                           |
| ----------------------- | --------------------------------------------------------------- |
| Backend                 | `sudo docker compose logs backend` (JSON lines, one per event). |
| Web app                 | `sudo docker compose logs web` (the Next.js server).            |
| Caddy                   | `sudo docker compose logs caddy`.                               |
| Nightly database backup | `journalctl -u koremonitor-backup` on the server.               |
| Backup agents           | `journalctl -u flatline-backup@<name>` on the agent's host.     |
| Agent                   | `journalctl -u superboard` on the host.                         |
| Local dev               | `.dev-logs/` (`dev.sh logs` follows them).                      |

The backend logs at `info` for lifecycle events and `warn`/`error` for failures;
ingest and rollup problems are logged with the monitor id, which is what makes a
stale card traceable to a cause.

Container logs rotate at 10 MB × 5 files (`logging` in the compose files), so
`docker logs` reaches back about 50 MB; ship them elsewhere if longer history is
needed.

## Repository hygiene

Git-ignored, and never committed: `data/`, `.dev-data/`, `.dev-logs/`, `private/`,
`tmp/`, `backend/target/`, `node_modules/` and the web app's build output
(`apps/web/.next/`). Production credentials live outside the repository, in a
root-only directory on the server.
