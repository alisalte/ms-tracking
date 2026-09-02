# Multi-stage Dockerfile for mdvr-streamer-service (Node media plane + ffmpeg).
#
# Build context is the repo root so workspace packages resolve:
#   docker build -f apps/mdvr-streamer-service/Dockerfile .
#
# syntax=docker/dockerfile:1.7

# ---- Stage 1: build ----------------------------------------------------------
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Workspace manifests first for a deterministic, cached dependency install.
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

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter @fleetvision/mdvr-streamer-service --frozen-lockfile

# Build the protocol package then the service (tsc project references).
COPY packages/shared-kernel ./packages/shared-kernel
COPY packages/meitrack-media-protocol ./packages/meitrack-media-protocol
COPY apps/mdvr-streamer-service ./apps/mdvr-streamer-service
RUN pnpm --filter @fleetvision/meitrack-media-protocol build \
  && pnpm --filter @fleetvision/mdvr-streamer-service build

# ---- Stage 2: runtime (node + ffmpeg, non-root) ------------------------------
FROM node:22-bookworm-slim
RUN for i in 1 2 3; do apt-get update && break || sleep 5; done \
  && for i in 1 2 3; do apt-get install -y --no-install-recommends ffmpeg ca-certificates && break || sleep 5; done \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/meitrack-media-protocol ./packages/meitrack-media-protocol
COPY --from=builder /app/apps/mdvr-streamer-service/node_modules ./apps/mdvr-streamer-service/node_modules
COPY --from=builder /app/apps/mdvr-streamer-service/dist ./apps/mdvr-streamer-service/dist
COPY --from=builder /app/apps/mdvr-streamer-service/package.json ./apps/mdvr-streamer-service/package.json

# HTTP/WS (3013) for players; 6182 is published separately (device media plane).
EXPOSE 3013 6182

CMD ["node", "apps/mdvr-streamer-service/dist/main.js"]
