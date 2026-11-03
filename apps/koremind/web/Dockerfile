# KoreMind web UI (Next.js standalone server). Build from the repository root:
#   docker build -f web/Dockerfile -t koremind-web .
# The UI holds no backend address: people enter it on the connect screen, so one image fits every setup.
ARG BUN_VERSION=1.4.3  # keep in sync with .bun-version
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS node

FROM oven/bun:${BUN_VERSION}-debian AS build
# `next build` runs under Node; Bun installs the dependencies.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY shared/package.json shared/
COPY web/package.json web/
RUN bun install --frozen-lockfile --filter './web' --filter './shared'
COPY shared ./shared
COPY web ./web
ENV KOREMIND_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN cd web && bun run build

FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3210
COPY --from=build --chown=node:node /app/web/.next/standalone ./
COPY --from=build --chown=node:node /app/web/.next/static ./web/.next/static
USER node
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "web/server.js"]
