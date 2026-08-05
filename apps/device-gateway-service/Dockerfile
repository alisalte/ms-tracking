# Multi-stage Dockerfile for device-gateway-service.
# Stage 1 builds every workspace package + the app from a pnpm install; stage 2
# copies only the compiled output + production deps into a distroless non-root
# image (<200MB, no shell — runs as non-root).
#
# Build context is the repo root so workspace packages resolve: build with
# `docker build -f apps/device-gateway-service/Dockerfile .` from the repo root.

# syntax=docker/dockerfile:1.7

# ---- Stage 1: build ----------------------------------------------------------
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace manifests first for deterministic, cached dependency install.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json biome.json .npmrc ./
COPY apps/device-gateway-service/package.json ./apps/device-gateway-service/
COPY packages/shared-kernel/package.json ./packages/shared-kernel/
COPY packages/config/package.json ./packages/config/
COPY packages/observability/package.json ./packages/observability/
COPY packages/persistence-knex/package.json ./packages/persistence-knex/
COPY packages/cache-redis/package.json ./packages/cache-redis/
COPY packages/health/package.json ./packages/health/
COPY packages/web/package.json ./packages/web/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy source and build the whole composite graph (apps + packages).
COPY packages ./packages
COPY apps/device-gateway-service ./apps/device-gateway-service
RUN pnpm build

# Prune to production deps for the runtime image.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm prune --prod

# ---- Stage 2: runtime (distroless, non-root) --------------------------------
FROM gcr.io/distroless/nodejs22-debian12:nonroot
ENV NODE_ENV=production
WORKDIR /app

# Compiled output + production node_modules.
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/packages ./packages
COPY --from=builder --chown=nonroot:nonroot /app/apps/device-gateway-service/dist ./dist
COPY --from=builder --chown=nonroot:nonroot /app/apps/device-gateway-service/package.json ./package.json

# distroless runs as UID 65532 (nonroot) by default — no shell, no root.
USER nonroot
# Admin HTTP port. Protocol TCP/UDP listeners open their own ports (configured).
EXPOSE 8081
CMD ["dist/main.js"]
