# syntax=docker/dockerfile:1

# Kore Drive web: the Next.js standalone server (SSR) on Node 24 LTS.
# Built from the monorepo root (it uses packages/kore-ui):
#   docker build -f apps/kore-drive/web/Dockerfile -t kore-web:local .
ARG BUN_VERSION=1.4.3
FROM oven/bun:${BUN_VERSION}-alpine AS bun

# 1. Only this app's workspace slice of the monorepo, with a matching bun.lock.
FROM node:24-alpine AS prune
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
COPY . .
RUN bun x turbo@2.11.11 prune @kore/drive-web --docker

# 2. Install and build. Same libc as the runtime image (musl), for native modules.
FROM node:24-alpine AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=prune /repo/out/json/ ./
COPY --from=prune /repo/bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
# Baked into the /api rewrite in next.config.ts (unused behind Caddy, which
# routes /api itself, but it should point at the API all the same).
ARG API_URL=http://api:8080
ENV API_URL=${API_URL}
RUN bun run --cwd apps/kore-drive/web build

FROM node:24-alpine
LABEL org.opencontainers.image.source="https://github.com/qarasky/kore" \
      org.opencontainers.image.title="kore-web"
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    API_URL=http://api:8080
# The standalone output traces from the monorepo root, so the server sits at
# apps/kore-drive/web/server.js. Files stay root-owned (read-only for the app user).
COPY --from=build /app/apps/kore-drive/web/.next/standalone ./
COPY --from=build /app/apps/kore-drive/web/.next/static ./apps/kore-drive/web/.next/static
COPY --from=build /app/apps/kore-drive/web/public ./apps/kore-drive/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/kore-drive/web/server.js"]
