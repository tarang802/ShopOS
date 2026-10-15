# syntax=docker/dockerfile:1
#
# ShopOS API.
#
# Build from the repository root:   docker build -f deploy/api.Dockerfile -t shopos-api .
#
# Stages
#   deps    every workspace's dependencies, development ones included
#   build   bundles the API (and the shared package) with tsup
#   tools   deps + source, for one-off jobs such as seeding demo data
#   runtime production dependencies and the bundle only, running as a non-root user

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
RUN npm run build --workspace @shopos/api

FROM build AS tools
ENV NODE_ENV=development
WORKDIR /app/apps/api
CMD ["npm", "run", "seed"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/shared packages/shared
RUN npm ci --omit=dev --workspace @shopos/api --include-workspace-root=false \
  && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist

USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health/ready >/dev/null || exit 1
WORKDIR /app/apps/api
CMD ["node", "dist/server.js"]
