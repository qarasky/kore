# KoreMind backend + the OpenCode engine it owns. Build from the repository root:
#   docker build -f backend/Dockerfile -t koremind-backend .
ARG BUN_VERSION=1.4.3  # keep in sync with .bun-version

FROM oven/bun:${BUN_VERSION}-debian AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY shared/package.json shared/
COPY web/package.json web/
RUN bun install --frozen-lockfile --production --filter './backend' --filter './shared'

FROM oven/bun:${BUN_VERSION}-debian
# KoreMind needs OpenCode v2. Pinned so an image is reproducible; bump it deliberately.
ARG OPENCODE_VERSION=2.2.5
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tar tini \
 && rm -rf /var/lib/apt/lists/* \
 && HOME=/opt/opencode curl -fsSL https://opencode.ai/v2/install | HOME=/opt/opencode bash -s -- --version "${OPENCODE_VERSION}" --no-modify-path \
 && /opt/opencode/.opencode/bin/opencode --version \
 && apt-get purge -y curl && apt-get autoremove -y

RUN useradd --system --uid 10001 --create-home --home-dir /home/koremind koremind \
 && mkdir /data && chown koremind:koremind /data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY package.json ./
COPY backend ./backend
COPY shared ./shared

ENV NODE_ENV=production \
    KOREMIND_DATA_DIR=/data \
    KOREMIND_PORT=8787 \
    KOREMIND_OPENCODE_BIN=/opt/opencode/.opencode/bin/opencode
USER koremind
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:' + (process.env.KOREMIND_PORT ?? 8787) + '/health'); process.exit(r.ok ? 0 : 1)"]
ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "backend/src/index.ts"]
