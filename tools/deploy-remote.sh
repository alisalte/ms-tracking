#!/usr/bin/env bash
# Pull tagged images and recreate the FleetVision stack on the server.
# Expected layout:
#   /opt/fleetvision/.env          secrets (not in git)
#   /opt/fleetvision/repo          this repository (git checkout)
#
# Usage (from the repo root, as the deploy user):
#   IMAGE_TAG=<sha> IMAGE_REGISTRY=ghcr.io/owner/repo ./tools/deploy-remote.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${FLEETVISION_ENV:-/opt/fleetvision/.env}"
COMPOSE_DIR="${ROOT}/infra/docker"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing env file: ${ENV_FILE}" >&2
  echo "copy infra/docker/.env.production.example → ${ENV_FILE} and fill secrets." >&2
  exit 1
fi

# Caller / CD exports beat values in the env file.
_TAG="${DEPLOY_IMAGE_TAG:-${IMAGE_TAG:-}}"
_REG="${DEPLOY_IMAGE_REGISTRY:-${IMAGE_REGISTRY:-}}"
# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a
[[ -n "${_TAG}" ]] && IMAGE_TAG="${_TAG}"
[[ -n "${_REG}" ]] && IMAGE_REGISTRY="${_REG}"

: "${IMAGE_REGISTRY:?set IMAGE_REGISTRY (ghcr.io/<owner>/<repo> lowercase)}"
: "${IMAGE_TAG:?set IMAGE_TAG (git sha or main)}"

# compose --env-file does not override already-exported IMAGE_* .
export IMAGE_TAG IMAGE_REGISTRY

COMPOSE=(
  docker compose
  --project-name fleetvision
  -f "${COMPOSE_DIR}/docker-compose.yml"
  -f "${COMPOSE_DIR}/docker-compose.prod.yml"
  --env-file "${ENV_FILE}"
)

echo "deploying ${IMAGE_REGISTRY} @ ${IMAGE_TAG}"
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 180
"${COMPOSE[@]}" ps
echo "deploy complete"
