# Banana Studio web workspace server: the hosted frontend, `api/` functions,
# image queue and Supabase gateway in one process. compose.yaml runs it with the
# Supabase services it needs. See docs/en/docker.md.
# The Node version matches desktop/node-runtime.json and CI.
ARG NODE_IMAGE=node:24.19.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-fund --no-audit
COPY . .
RUN npm run build && node scripts/build-server.mjs /app

FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.mjs"]
