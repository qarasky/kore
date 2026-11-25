# syntax=docker/dockerfile:1

# KoreMonitor's web app: the Next.js standalone server (operator UI, Superboard,
# status pages). Built from the Kore monorepo root, because the app imports
# packages/shared and packages/kore-ui:
#
#   docker build -f apps/kore-monitor/docker/web.dockerfile \
#       --build-arg KOREMONITOR_BUILD_ID=$(git rev-parse --short HEAD) \
#       -t kore-monitor-web:local .
#
# KOREMONITOR_BUILD_ID is the build id open tabs compare against `/build` to
# notice a deploy; without it the build time is used. The pre-rename
# FLATLINE_BUILD_ID build arg is still accepted.
ARG BUN_VERSION=1.4.3
FROM oven/bun:${BUN_VERSION}-debian AS bun

FROM node:26-trixie-slim AS prune
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
COPY . .
RUN bun x turbo@2.11.11 prune @kore/monitor-web --docker

FROM node:26-trixie-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=prune /repo/out/json/ ./
COPY --from=prune /repo/bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
# The /api and /agent rewrites in next.config.ts are baked at build time;
# behind Caddy they are never reached, but they should point at the backend.
ARG API_URL=http://backend:3001
ARG KOREMONITOR_BUILD_ID=
ARG FLATLINE_BUILD_ID=
# Both ids reach next.config.ts, which prefers KOREMONITOR_BUILD_ID.
ENV API_URL=${API_URL} KOREMONITOR_BUILD_ID=${KOREMONITOR_BUILD_ID} FLATLINE_BUILD_ID=${FLATLINE_BUILD_ID}
RUN bun run --cwd apps/kore-monitor/apps/web build

FROM node:26-trixie-slim AS release
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    API_URL=http://backend:3001
# The standalone output traces from the monorepo root, so the server sits at
# apps/kore-monitor/apps/web/server.js. Files stay root-owned: read-only for the app user.
COPY --from=build /app/apps/kore-monitor/apps/web/.next/standalone ./
COPY --from=build /app/apps/kore-monitor/apps/web/.next/static ./apps/kore-monitor/apps/web/.next/static
COPY --from=build /app/apps/kore-monitor/apps/web/public ./apps/kore-monitor/apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/build').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/kore-monitor/apps/web/server.js"]
