# Multi-stage Dockerfile for reporting-service.
# Stage 1 builds the app from a full pnpm install; stage 2 installs only
# production deps + copies the compiled output into a slim non-root image.
#
# Build context is the repo root so workspace packages resolve: build with
# `docker build -f apps/reporting-service/Dockerfile .` from the repo root.
#
# syntax=docker/dockerfile:1.7

# ---- Stage 1: build ----------------------------------------------------------
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace manifests first for deterministic, cached dependency install.
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

# Copy source and build reporting-service + its workspace package deps.
COPY packages ./packages
COPY apps/reporting-service ./apps/reporting-service
RUN pnpm --filter @fleetvision/reporting-service... build

# ---- Stage 2: runtime (non-root) -------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=builder /app/apps/reporting-service/package.json ./apps/reporting-service/
COPY --from=builder /app/packages ./packages
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" \
    npm_config_fetch_retries=5 npm_config_fetch_timeout=120000
# pnpm comes from the builder's corepack cache — the runtime stage never re-downloads it (flaky-registry-proof).
COPY --from=builder /root/.cache/node/corepack /root/.cache/node/corepack

RUN --mount=type=cache,id=pnpm,target=/pnpm/store corepack enable && corepack prepare pnpm@9.15.0 --activate \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && chown -R node:node /app

COPY --from=builder --chown=node:node /app/apps/reporting-service/dist ./apps/reporting-service/dist

USER node
WORKDIR /app/apps/reporting-service
EXPOSE 3011
CMD ["node", "dist/main.js"]
