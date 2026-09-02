# Multi-stage Dockerfile for the FleetVision web-dashboard (Vite SPA → nginx).
#
# Build context is the repo root so the @fleetvision/* workspace packages
# resolve: build with `docker build -f apps/web-dashboard/Dockerfile .`
# from the repo root.
#
# syntax=docker/dockerfile:1.7

# ---- Stage 1: build the SPA -----------------------------------------------
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace manifests first for a deterministic, cached dependency install.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json biome.json .npmrc ./
COPY apps/device-gateway-service/package.json ./apps/device-gateway-service/
COPY apps/fleet-management-service/package.json ./apps/fleet-management-service/
COPY apps/fleet-service/package.json ./apps/fleet-service/
COPY apps/gps-engine-service/package.json ./apps/gps-engine-service/
COPY apps/identity-service/package.json ./apps/identity-service/
COPY apps/map-engine-service/package.json ./apps/map-engine-service/
COPY apps/media-service/package.json ./apps/media-service/
COPY apps/notification-service/package.json ./apps/notification-service/
COPY apps/reporting-service/package.json ./apps/reporting-service/
COPY apps/web-dashboard/package.json ./apps/web-dashboard/
COPY apps/mdvr-streamer-service/package.json ./apps/mdvr-streamer-service/
COPY packages/shared-kernel/package.json ./packages/shared-kernel/
COPY packages/config/package.json ./packages/config/
COPY packages/observability/package.json ./packages/observability/
COPY packages/persistence-knex/package.json ./packages/persistence-knex/
COPY packages/cache-redis/package.json ./packages/cache-redis/
COPY packages/health/package.json ./packages/health/
COPY packages/auth/package.json ./packages/auth/
COPY packages/web/package.json ./packages/web/
COPY packages/meitrack-media-protocol/package.json ./packages/meitrack-media-protocol/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

# Copy the dashboard source and build the production bundle.
# Same-origin Socket.IO paths so the SPA works behind this nginx (no :3001/:3010).
ARG VITE_GPS_WS_URL=/gps-ws
ARG VITE_NOTIFICATION_WS_URL=/notif-ws
ENV VITE_GPS_WS_URL=$VITE_GPS_WS_URL \
    VITE_NOTIFICATION_WS_URL=$VITE_NOTIFICATION_WS_URL
COPY apps/web-dashboard ./apps/web-dashboard
RUN pnpm --filter @fleetvision/web-dashboard build

# ---- Stage 2: runtime (nginx, non-root) ------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV NODE_ENV=production

# The built static assets.
COPY --from=builder /app/apps/web-dashboard/dist /usr/share/nginx/html

# nginx config: SPA history-fallback + reverse-proxy /api → identity-service.
COPY apps/web-dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
