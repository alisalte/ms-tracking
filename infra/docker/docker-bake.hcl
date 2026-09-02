# Docker Bake — one build graph for every FleetVision app image.
# Used by CI (`docker buildx bake --push`) and optionally locally:
#   docker buildx bake -f infra/docker/docker-bake.hcl identity-service
#
# Tags: ${REGISTRY}/<image>:${TAG}  (TAG is usually the git SHA)

variable "REGISTRY" {
  default = "ghcr.io/fleetvision/ms06-clone-platform"
}

variable "TAG" {
  default = "local"
}

group "default" {
  targets = [
    "identity-service",
    "fleet-management-service",
    "fleet-service",
    "gps-engine-service",
    "notification-service",
    "reporting-service",
    "device-gateway-service",
    "mdvr-streamer-service",
    "media-service",
    "map-engine",
    "web-dashboard",
  ]
}

target "identity-service" {
  context    = "."
  dockerfile = "apps/identity-service/Dockerfile"
  tags       = ["${REGISTRY}/identity-service:${TAG}"]
}

target "fleet-management-service" {
  context    = "."
  dockerfile = "apps/fleet-management-service/Dockerfile"
  tags       = ["${REGISTRY}/fleet-management-service:${TAG}"]
}

target "fleet-service" {
  context    = "."
  dockerfile = "apps/fleet-service/Dockerfile"
  tags       = ["${REGISTRY}/fleet-service:${TAG}"]
}

target "gps-engine-service" {
  context    = "."
  dockerfile = "apps/gps-engine-service/Dockerfile"
  tags       = ["${REGISTRY}/gps-engine-service:${TAG}"]
}

target "notification-service" {
  context    = "."
  dockerfile = "apps/notification-service/Dockerfile"
  tags       = ["${REGISTRY}/notification-service:${TAG}"]
}

target "reporting-service" {
  context    = "."
  dockerfile = "apps/reporting-service/Dockerfile"
  tags       = ["${REGISTRY}/reporting-service:${TAG}"]
}

target "device-gateway-service" {
  context    = "."
  dockerfile = "apps/device-gateway-service/Dockerfile"
  tags       = ["${REGISTRY}/device-gateway-service:${TAG}"]
}

target "mdvr-streamer-service" {
  context    = "."
  dockerfile = "apps/mdvr-streamer-service/Dockerfile"
  tags       = ["${REGISTRY}/mdvr-streamer-service:${TAG}"]
}

target "media-service" {
  context    = "."
  dockerfile = "apps/media-service/Dockerfile"
  tags       = ["${REGISTRY}/media-service:${TAG}"]
}

target "map-engine" {
  context    = "."
  dockerfile = "apps/map-engine-service/Dockerfile"
  tags       = ["${REGISTRY}/map-engine:${TAG}"]
}

target "web-dashboard" {
  context    = "."
  dockerfile = "apps/web-dashboard/Dockerfile"
  tags       = ["${REGISTRY}/web-dashboard:${TAG}"]
  args = {
    VITE_GPS_WS_URL            = "/gps-ws"
    VITE_NOTIFICATION_WS_URL   = "/notif-ws"
  }
}
