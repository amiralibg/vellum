# Vellum: one image serving the API, the reader pages (/p) and the dashboard.
# Build from the repo root: docker build -t vellum .

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
# Manifests first, so the install layers are cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/

# Reader CSS, the dashboard (apps/web/dist) and the API bundle (apps/api/dist).
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm build

# Runtime dependencies of the API only. @vellum/shared is bundled into dist.
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @vellum/api

FROM node:22-alpine
RUN apk add --no-cache dumb-init \
  && addgroup -g 1001 -S nodejs \
  && adduser -S -u 1001 -G nodejs nodejs \
  && mkdir /data && chown nodejs:nodejs /data
ENV NODE_ENV=production PORT=8000 DATA_DIR=/data
WORKDIR /app
# The code stays owned by root and read-only to the app; only /data is writable.
# Same layout as the repo: the API finds public/, ../web/dist and ../../packages/ui/fonts relative to itself.
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/public apps/api/public
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/packages/ui/fonts packages/ui/fonts
USER nodejs
WORKDIR /app/apps/api
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
