# Deploying KoreMind on Linux

> Prefer containers? [docs/deployment-docker.md](deployment-docker.md) runs the same thing from prebuilt images, with no Bun or OpenCode to install. **Claude needs this native install**: it uses the server's own `claude` CLI and its login.

How to run KoreMind as a service on a Linux server (a home server, a mini PC, a VPS). Written for Debian/Ubuntu-style systems with systemd; other distributions need only the package names changed.

> **Status.** These steps were written from how KoreMind runs on the author's Mac and from the project's own start script and tests. They have **not** been run on a real Linux host yet. Expect to fix a small thing or two on the first try, and please correct this document when you do.

## 1. What runs

One service, `koremind`, started with `bun run start`. It launches two processes that you do not need to manage separately:

| Process | Port | Notes |
| --- | --- | --- |
| Backend (Bun) | `8787` | REST + SSE API. Binds all interfaces (`KOREMIND_HOST` to change). It runs `claude -p` per answer and, when an OpenCode provider is listed, starts and owns the OpenCode engine. |
| Web UI (Next.js, production build) | `3210` | Talks to the backend by URL from the browser. |
| Claude (`claude -p`) | none | One short-lived process per answer, as the service user, in `$KOREMIND_DATA_DIR/claude-work`. |
| OpenCode engine | random, `127.0.0.1` only | Only with `opencode` / `opencode-go` in `KOREMIND_PROVIDERS`. Started by the backend. Never reachable from outside. |

Everything KoreMind stores lives under one directory, `KOREMIND_DATA_DIR` (this guide uses `/var/lib/koremind`).

## 2. Requirements

- A 64-bit Linux (x86-64 or ARM64) with systemd, `curl`, `git`, `unzip`.
- 1 GB of RAM is enough for one person; the models run on the provider's servers, not here.
- Outbound internet (Anthropic, OpenCode, web search).
- Optional: Tailscale or a Cloudflare tunnel for use away from home (section 6).

## 3. Install

Run as a normal user with `sudo`. Replace the repository URL with yours.

```bash
# 3.1 A dedicated user and directories
sudo useradd --system --create-home --home-dir /home/koremind --shell /bin/bash koremind
sudo mkdir -p /opt/koremind /var/lib/koremind /etc/koremind
sudo chown koremind:koremind /opt/koremind /var/lib/koremind
sudo chmod 700 /var/lib/koremind            # holds chats and OpenCode's sign-ins

# 3.2 Bun, Claude Code and (optional) OpenCode for that user
sudo -iu koremind bash -c 'curl -fsSL https://bun.sh/install | bash'
sudo -iu koremind bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
sudo -iu koremind bash -c 'curl -fsSL https://opencode.ai/v2/install | bash'     # only for OpenCode providers
sudo -iu koremind bash -c 'command -v bun; ~/.local/bin/claude --version; command -v opencode; opencode --version'

# 3.3 Sign Claude in, as that user (KoreMind never sees or stores this login)
sudo -iu koremind bash -c '~/.local/bin/claude auth login'   # opens a link; finish it in any browser
```

OpenCode Go signs in with `OPENCODE_API_KEY=…` in `/etc/koremind/koremind.env` (step 3.5). KoreMind runs OpenCode in its own data folder, so `opencode auth login` in a shell would sign in a different one.

Claude runs on **the owner's own subscription**, so it is offered to the owner's account only. Read [claude-integration.md](claude-integration.md) first. Use the service user's login only if nobody else uses that account's `claude`; otherwise set `KOREMIND_CLAUDE_CONFIG_DIR` to a folder of its own and log in with `CLAUDE_CONFIG_DIR=<that folder> claude auth login`.

For OpenCode the version must start with `v2`. KoreMind needs OpenCode **v2**; the older v1 has a different API. If `opencode` is not on the PATH, find where the installer put it and use that path in `KOREMIND_OPENCODE_BIN` (step 3.5). The standalone binaries on <https://opencode.ai/v2/docs/> also work.

```bash
# 3.4 Get the code and build the web UI
sudo -u koremind git clone git@github.com:qarasky/koremind.git /opt/koremind      # or your remote
sudo -iu koremind bash -c 'cd /opt/koremind && bun install && bun run build'

# 3.5 Configuration
sudo cp /opt/koremind/deploy/koremind.env.example /etc/koremind/koremind.env
sudo chown root:koremind /etc/koremind/koremind.env && sudo chmod 640 /etc/koremind/koremind.env
sudoedit /etc/koremind/koremind.env              # KOREMIND_PROVIDERS, KOREMIND_CLAUDE_BIN, the Kore ID settings

# 3.6 The service
sudo cp /opt/koremind/deploy/koremind.service /etc/systemd/system/koremind.service
sudo systemctl daemon-reload
sudo systemctl enable --now koremind
```

If you installed Bun, Claude Code or OpenCode somewhere other than `/home/koremind/.bun`, `/home/koremind/.local/bin` and `/home/koremind/.opencode`, edit `ExecStart` and `Environment=PATH=` in the unit first. If the web UI runs elsewhere (for example in Docker), switch the unit to its backend-only `ExecStart`. systemd gives services a minimal `PATH`, which is the usual reason for "command not found" at start.

## 4. First start

```bash
systemctl status koremind
journalctl -u koremind -f                    # logs; Ctrl-C to leave
curl http://localhost:8787/health        # {"name":"koremind","version":"…","setupRequired":true,"sso":true}
```

The log lists the addresses the backend is reachable at (local network, Tailscale, your `KOREMIND_PUBLIC_URL`).

**Kore ID is the only way in.** Before anyone opens the web UI, set `KOREMIND_OIDC_ISSUER`, the client secret, `KOREMIND_PUBLIC_URL`, `KOREMIND_WEB_ORIGINS` and `KOREMIND_OIDC_OWNER_EMAIL` in `/etc/koremind/koremind.env` (see [kore-id.md](kore-id.md) and [deployment-docker.md](deployment-docker.md)). Restart, open `http://<server-address>:3210` and choose **Continue with Kore ID** as the pinned owner. That first sign-in creates the owner account; everyone else gets an account automatically on their first Kore ID sign-in. There is no password setup and no registration form.

**Settings → Providers** shows each provider in `KOREMIND_PROVIDERS` as signed in on the server or not, with the command to run when it isn't. There is nothing to connect from the apps.

## 5. The phone

1. Build or fetch the APK. On any machine with a JDK 17+ and the Android SDK: `cd android && ./gradlew :app:assembleDebug`; the file is `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to the phone (`adb install -r app-debug.apk`, or any file transfer) and allow installs from that source.
2. In the web UI open **Settings → Account → Show QR code**.
3. In the app tap **Scan QR code** and point it at the screen. The code was minted from your signed-in Kore ID web session, so the phone tries each address in it until one works and signs in as you. Scanning needs Google Play services on the phone; otherwise type an address into **Backend URL** and choose **Continue with Kore ID**.

The app allows plain `http://` to the address you give it, because KoreMind does not set up TLS itself.

## 6. Reaching KoreMind away from home

KoreMind deliberately does not configure tunnels or certificates. Choose one:

**Tailscale (simplest).** Install it on the server (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`) and on your phone and laptop. KoreMind prints the server's Tailscale address (a `100.x.y.z` address) at start and includes it in the QR code. Nothing else to do.

**Cloudflare Tunnel or your own domain.** The web UI and the backend are two separate origins, so give each a hostname:

| Hostname (example) | Points to |
| --- | --- |
| `koremind.example.com` | `http://localhost:3210` |
| `api.koremind.example.com` | `http://localhost:8787` |

Then set `KOREMIND_PUBLIC_URL=https://api.koremind.example.com` in `/etc/koremind/koremind.env` and `sudo systemctl restart koremind`. Notes:

- Use HTTPS for **both**. A page served over HTTPS cannot call an `http://` backend (browsers block it).
- The web UI guesses its backend as `<this host>:8787`, which only fits the plain local setup. On the first visit through hostnames, the **Connect to your server** screen appears: enter `https://api.koremind.example.com`.
- Streaming answers need the proxy not to buffer. The backend already sends `x-accel-buffering: no`; on nginx also set `proxy_buffering off;` and a long `proxy_read_timeout` for the API host.
- A proxy on this machine is recognised automatically, so sign-in and pairing rate limiting see the real client address. Set `KOREMIND_TRUST_PROXY=1` only if the proxy is on a different machine, or for a tunnel on this machine together with `KOREMIND_HOST=127.0.0.1`, so nothing else can reach the backend and set `x-forwarded-for`.
- **Do not expose `/mcp`.** It is how the local engines (Claude, OpenCode) reach KoreMind's notes tools. It only accepts loopback callers with a secret that changes at every start, but add a deny rule for `/mcp` in your proxy anyway.

## 7. Firewall

Allow `8787` and `3210` only from where you need them. With ufw:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8787,3210 proto tcp   # your LAN
sudo ufw allow in on tailscale0                                       # Tailscale
sudo ufw enable
```

Do not open `8787` to the whole internet over plain HTTP: session tokens and chats would cross the network unencrypted. Sign-in and pairing attempts are rate limited, which is a guard rail, not a substitute for TLS or Tailscale.

## 8. Operating it

| Task | Command |
| --- | --- |
| Status / logs | `systemctl status koremind` / `journalctl -u koremind -f` |
| Restart | `sudo systemctl restart koremind` |
| Update | `sudo -iu koremind bash -c 'cd /opt/koremind && git pull && bun install && bun run build'` then `sudo systemctl restart koremind` |
| Check health | `curl http://localhost:8787/health` |
| Stop | `sudo systemctl stop koremind` (this also stops the OpenCode engine and any running `claude`) |

Database migrations run automatically when the backend starts.

### Backups

Back up `/var/lib/koremind`. It contains:

| Path | What |
| --- | --- |
| `koremind.sqlite` (+ `-wal`, `-shm`) | accounts, chats, notes, settings |
| `users/<id>/memory.md` | each user's memory |
| `uploads/` | attachments |
| `opencode/` | OpenCode's state, **including its sign-ins** |
| `claude-work/` | the empty folder `claude -p` runs in (Claude's own conversations live in the service user's `~/.claude/projects/`) |

The simplest safe backup is to stop the service, copy, and start it again:

```bash
sudo systemctl stop koremind && sudo tar czf /root/koremind-$(date +%F).tgz -C /var/lib koremind && sudo systemctl start koremind
```

For a live backup of the database alone: `sqlite3 /var/lib/koremind/koremind.sqlite ".backup '/root/koremind.sqlite'"`. Treat backups like secrets, since they include OpenCode's sign-ins.

### Signing Claude in on a headless server

`claude auth login` prints a link: open it in any browser, sign in with Anthropic, and paste the code it shows back into the terminal. The login stays in the service user's `~/.claude` (or `KOREMIND_CLAUDE_CONFIG_DIR`) and is refreshed by the CLI itself. Check it with `sudo -iu koremind bash -c '~/.local/bin/claude auth status'`.

## 9. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `systemctl status koremind` shows `bun: command not found` or `opencode server did not start` | `PATH` or `KOREMIND_OPENCODE_BIN` is wrong; the service does not read your shell profile. |
| The log says the engine "exited during startup" | OpenCode is v1, or cannot write its state. Check `opencode --version` and that `/var/lib/koremind` is owned by `koremind`. |
| Web UI opens but asks for a server address | Expected when you open it through a hostname or a different host than the backend. Enter the backend URL once. |
| Phone says it couldn't reach the server | Different network, or the firewall. Open the printed address in the phone's browser: it should show a small JSON answer at `/health`. |
| "No provider can answer" in chat | A usage limit is reached (Claude's plan, or OpenCode's free quota), or the provider isn't signed in on the server. Check `claude auth status` as the service user, and `OPENCODE_API_KEY` for OpenCode Go. |
| Claude shows "Not signed in on the server" | Run `claude auth login` as the user the service runs as, or check `KOREMIND_CLAUDE_BIN` / `KOREMIND_CLAUDE_CONFIG_DIR`. |
| Answers stop after a few seconds behind a proxy | The proxy is buffering the stream; see section 6. |
| The page is blank after an update | Run `bun run build` again, then restart. The web UI is a production build. |

## 10. Uninstall

```bash
sudo systemctl disable --now koremind && sudo rm /etc/systemd/system/koremind.service
sudo rm -rf /opt/koremind /etc/koremind            # keep /var/lib/koremind if you want your data
sudo userdel koremind
```
