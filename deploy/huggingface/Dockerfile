# syntax=docker/dockerfile:1.7
# The hosted demo on Hugging Face Spaces (Docker SDK). Same app as the root Dockerfile, set up
# for a Space: port 7860, user 1000, a temporary disk. Films are published to the Cloudflare
# share worker (SHARE_URL), and everything else lives in Postgres (DATABASE_URL), so a
# restart or a sleeping Space loses nothing.
FROM node:24-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm dashboard:build && pnpm prune --prod --ignore-scripts

FROM node:24-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-core fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PORT=7860 \
    FILMS_DIR=/tmp/films \
    HOSTED=true \
    WORKER_CONCURRENCY=1 \
    POLL_INTERVAL_MS=3000 \
    DB_POOL_SIZE=5
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/package.json ./
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/src ./src
COPY --from=build --chown=1000:1000 /app/profiles ./profiles
COPY --from=build --chown=1000:1000 /app/dashboard/dist ./dashboard/dist
USER 1000
EXPOSE 7860
CMD ["node", "src/main.ts", "all"]
