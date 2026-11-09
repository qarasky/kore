# Agent instructions for KoreMonitor

KoreMonitor is a self-hosted uptime monitor and fleet-telemetry system with its
own Rust backend, a Go host agent, a Go backup agent and a Next.js web app,
deployed as one origin behind Caddy.

Start with [docs/README.md](docs/README.md): it routes every task to the right
document. This file holds only what an agent needs before it opens that index.

## Layout

| Path               | What                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| `backend-rs/`      | Rust backend (API, check engine, storage, agent downloads), migrations.         |
| `superboard/`      | Go telemetry agent on each host; `superboard/mockagent` for dev.                |
| `backup-agent/`    | Go backup agent (`flatline-backup`), independent of `superboard`.               |
| `apps/web/`        | Next.js web app: operator UI, Superboard, status pages.                         |
| `packages/shared/` | Status-page client and types used by the web app.                               |
| `docker/`          | Dockerfiles (backend, web, Caddy), Caddyfile, backups override, nightly backup. |
| `docs/`            | All documentation; `provisioning.md` is served from the binary.                 |

## Checks

Run the ones that cover what you touched before calling work done.

| Area         | Command                                                               |
| ------------ | --------------------------------------------------------------------- |
| Formatting   | `npm run fmt:check` (fix with `npm run fmt`; never hand-format)       |
| Backend      | `cargo test --manifest-path backend-rs/Cargo.toml`                    |
| Web app      | `npm run test:web && npm run typecheck:web` (and `npm run build:web`) |
| Agent        | `cd superboard && gofmt -l . && go vet ./... && go test ./...`        |
| Backup agent | `cd backup-agent && go vet ./... && go test -race ./...`              |
| Local stack  | `./dev.sh` (backend `:3001`, web `:3003`, mock fleet), `status`       |

`backend-rs/` is rustfmt-formatted: run `cargo fmt` there (or `cargo fmt --check`) before committing.

## Rules

- **Docs change with behaviour.** If a change alters what a user, operator or
  agent sees, update the matching file in `docs/` in the same commit.
- **Migrations are additive and ordered.** Add `backend-rs/migrations/NNNN_*.sql`;
  never edit an applied one. The backend refuses a database with migrations it
  does not know, so a rollback needs the matching database backup.
- **Agent changes need a version bump to ship.** Hosts self-update only to a
  newer `version` in `superboard/main.go`. Bump it (and the version examples in
  `docs/agent.md`, `docs/superboard.md`, `docs/deployment.md` and the mock
  agent) whenever agent code changes.
- **The backup agent has its own version line.** `const version` in
  `backup-agent/main.go` (`0.x`) is separate from the telemetry agent's; bump it
  whenever backup-agent code changes, or hosts never self-update to it.
- **New agent config keys** get a default in `superboard/config.go` and a row
  in `docs/agent.md`.
- **API routes** are registered in `backend-rs/src/api/mod.rs` and documented
  in `backend-rs/src/api/openapi.json`, the served contract.
- **One level of operator access.** Member accounts (created only by Kore ID)
  and `kmon_op_` operator API tokens are both full-permission operator
  credentials; push tokens only affect their own monitor; backup-agent tokens
  are separate again. Kore ID sign-in (`docs/sso.md`) is the **only** browser
  sign-in: it creates the same full-permission accounts for everyone Kore ID
  admits to the `flatline` app (access is managed in Kore ID's admin;
  `KORE_ID_ALLOWED_*` are an optional extra filter). There is no password,
  first-account or operator-token login. Never describe roles, scoped or
  read-only tokens or accounts.
- **The agents are push-only.** Neither agent listens on a port and the backend
  never connects to a client host.
- Commit subjects follow `type(scope): summary` (`feat(agent): ...`,
  `fix(web): ...`, `docs: ...`). No emoji in code or commits.
- **Never push, deploy or restart production without an explicit go-ahead**
  from the user in the current conversation.

## Your own install

Anything specific to one install (hosts, addresses, clients, release log)
lives outside the repository. If a gitignored `ops/` folder exists, read
`ops/AGENTS.md` before any deploy or host work; never commit it.

- **Never ask for, print or store secrets in chat.** Redact tokens when
  printing configs (`push_token`, `tokenFile` contents, provisioning tokens).
