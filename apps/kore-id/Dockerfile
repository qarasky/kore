# syntax=docker/dockerfile:1

# Kore ID: one Node process serving the OIDC endpoints, the JSON API and the web UI.
# Built from the monorepo root (the web UI uses packages/kore-ui):
#   docker build -f apps/kore-id/Dockerfile -t kore-id:local .
ARG BUN_VERSION=1.4.3
FROM oven/bun:${BUN_VERSION}-debian AS bun

# 0. Workspace slices: the web UI (with kore-ui) and the server on its own.
FROM node:26-slim AS prune
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
COPY . .
RUN bun x turbo@2.11.11 prune @kore/id-web --docker --out-dir out-web \
 && bun x turbo@2.11.11 prune @kore/id --docker --out-dir out-server

# 1. The web UI (React + kore-ui) -> apps/kore-id/web/dist.
FROM node:26-slim AS web
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=prune /repo/out-web/json/ ./
COPY --from=prune /repo/bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY --from=prune /repo/out-web/full/ ./
RUN bun run --cwd apps/kore-id/web build

# 2. Server dependencies only (no TypeScript: Node strips the types itself).
FROM node:26-slim AS deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY --from=prune /repo/out-server/json/ ./
COPY --from=prune /repo/bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --production

# 3. Runtime: the same layout as before the monorepo (/app/src, /app/web/dist).
FROM node:26-slim
# Links the package to the repository on ghcr.io (the workflow adds the rest of the OCI labels).
LABEL org.opencontainers.image.source="https://github.com/qarasky/kore" \
      org.opencontainers.image.title="kore-id" \
      org.opencontainers.image.description="Kore ID: single sign-on for the Kore apps"
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data \
    CLIENTS_FILE=/data/clients.json \
    WEB_DIR=/app/web/dist
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/kore-id/package.json ./
COPY apps/kore-id/src ./src
COPY apps/kore-id/scripts ./scripts
COPY apps/kore-id/sdk ./sdk
COPY --from=web /app/apps/kore-id/web/dist ./web/dist
# /data holds the SQLite DB, the signing keys and clients.json. Back it up.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
# No curl in the image; Node checks itself.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "src/server.ts"]
