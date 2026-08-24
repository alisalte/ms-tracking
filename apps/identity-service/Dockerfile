# Multi-stage Dockerfile for identity-service.
# Stage 1 builds the app from a full pnpm install; stage 2 installs only
# production deps + copies the compiled output into a slim non-root image.
#
# Build context is the repo root so workspace packages resolve: build with
# `docker build -f apps/identity-service/Dockerfile .` from the repo root.
#
# syntax=docker/dockerfile:1.7

# ---- Stage 1: build ----------------------------------------------------------
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace manifests first for deterministic, cached dependency install.
# EVERY workspace member's manifest must be present before `pnpm install
# --frozen-lockfile` — the lockfile's importers cover all apps + packages, and a
# missing member makes pnpm prune that subtree's node_modules (surfaced by the
# Sprint E rebuild: packages/auth built without @nestjs/common).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json biome.json .npmrc ./
COPY apps/device-gateway-service/package.json ./apps/device-gateway-service/
COPY apps/fleet-management-service/package.json ./apps/fleet-management-service/
COPY apps/fleet-service/package.json ./apps/fleet-service/
COPY apps/gps-engine-service/package.json ./apps/gps-engine-service/
COPY apps/identity-service/package.json ./apps/identity-service/
COPY apps/map-engine-service/package.json ./apps/map-engine-service/
COPY apps/media-service/package.json ./apps/media-service/
COPY apps/notification-service/package.json ./apps/notification-service/
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

# Copy source and build the identity-service + its workspace package deps.
COPY packages ./packages
COPY apps/identity-service ./apps/identity-service
RUN pnpm --filter @fleetvision/identity-service... build

# ---- Stage 2: runtime (non-root) -------------------------------------------
# NOTE: the canonical base is `gcr.io/distroless/nodejs22-debian12:nonroot`
# (no shell, smaller). That registry is blocked from some regions (403), so we
# fall back to the Docker-Hub slim image running as the built-in `node` user.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies (workspace-aware). --ignore-scripts
# skips the root `prepare` husky hook (not present in a prod install).
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=builder /app/apps/identity-service/package.json ./apps/identity-service/
COPY --from=builder /app/packages ./packages
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" \
    npm_config_fetch_retries=5 npm_config_fetch_timeout=120000
# pnpm comes from the builder's corepack cache — the runtime stage never re-downloads it (flaky-registry-proof).
COPY --from=builder /root/.cache/node/corepack /root/.cache/node/corepack

RUN --mount=type=cache,id=pnpm,target=/pnpm/store corepack enable && corepack prepare pnpm@9.15.0 --activate \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && chown -R node:node /app

# Compiled output — kept under the app dir so Node's resolution finds the
# app's own node_modules (pnpm workspace symlinks live there).
COPY --from=builder --chown=node:node /app/apps/identity-service/dist ./apps/identity-service/dist

USER node
WORKDIR /app/apps/identity-service
EXPOSE 3000
CMD ["node", "dist/main.js"]
