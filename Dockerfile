# syntax=docker/dockerfile:1
#
# ShopOS as ONE container: the API, which also serves the built web app.
# This is the image to deploy to a container host (Render, Railway, Fly.io, a VPS).
# It needs only a MongoDB replica set (MongoDB Atlas, any tier) and two secrets.
#
#   docker build -t shopos .
#   docker run -p 4000:4000 --env-file .env.production shopos
#
# Stages
#   deps     every workspace's dependencies, development ones included
#   build    the API bundle (tsup) and the web app (Vite)
#   runtime  production dependencies, the API bundle and the web build, non-root

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
# The web app learns about Google Sign-In from the API at runtime, so the build
# needs no secrets and one image serves any environment.
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared packages/shared
RUN npm ci --omit=dev --workspace @shopos/api && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist

USER node
EXPOSE 4000
# Hosting platforms set PORT; the check follows it.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health/ready" >/dev/null || exit 1
WORKDIR /app/apps/api
CMD ["node", "dist/server.js"]
