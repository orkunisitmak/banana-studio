# Self-hosted Banana Studio: the standalone workspace server (SQLite + local
# media files) served to browsers. See docs/en/docker.md.
# The Node version matches desktop/node-runtime.json and CI.
ARG NODE_IMAGE=node:24.19.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-fund --no-audit
COPY . .
RUN npm run build && npm run build:desktop && node scripts/package-server.mjs /app

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    BANANA_SERVER=1 \
    BANANA_HOST=0.0.0.0 \
    BANANA_PORT=8080 \
    BANANA_DATA_DIR=/data \
    BANANA_WEB_ROOT=/app/web
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
# Health is answered without a session, but only for the configured public host.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "const u=new URL(process.env.BANANA_PUBLIC_URL||'http://localhost:8080');require('node:http').get({host:'127.0.0.1',port:process.env.BANANA_PORT,path:'/local/health',headers:{host:u.host}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "server.mjs"]
