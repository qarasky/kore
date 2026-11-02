<img src="assets/icon.svg" width="64" height="64" alt="">

# KoreCalendar

A self-hosted personal calendar with an API built for AI agents and custom integrations.
Go API + SQLite, Caddy in front. Web UI and Android app come in later phases.

Status: phase 1 (API and core) in progress. See `docs/superpowers/`.

## Develop

```sh
cd api && go vet ./... && go test -race -count=1 ./...
```
