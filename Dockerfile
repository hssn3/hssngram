# syntax=docker/dockerfile:1.7

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies first so Docker layers cache well.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build -w apps/web && npm run build -w apps/server

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=../web/dist \
    LOCAL_STORAGE_DIR=/data/uploads

RUN apk add --no-cache tini curl \
 && addgroup -S app && adduser -S app -G app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

RUN npm prune --omit=dev --no-audit --no-fund \
 && mkdir -p /data/uploads \
 && chown -R app:app /app /data

USER app
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
