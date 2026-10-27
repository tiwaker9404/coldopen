# syntax=docker/dockerfile:1.7
FROM node:24-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm dashboard:build && pnpm prune --prod --ignore-scripts

# Runtime: Node 24 runs the TypeScript sources natively; Chromium renders, ffmpeg encodes.
FROM node:24-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-core fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    FILMS_DIR=/data/films
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/profiles ./profiles
COPY --from=build /app/dashboard/dist ./dashboard/dist
RUN mkdir -p /data/films && chown -R node:node /data
USER node
VOLUME /data/films
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# roles: all | api | worker | migrate.  CLI: docker run ... node src/cli.ts https://acme.com
CMD ["node", "src/main.ts", "all"]
