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
COPY apps/web-dashboard/package.json ./apps/web-dashboard/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

# Copy the dashboard source and build the production bundle.
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
