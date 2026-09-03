# Bug: Drivers page returns 502

## Summary

`http://localhost:8080/assets?tab=drivers` shows `Request failed with status code 502`.

nginx proxies `/api/v1/fleet/` to `fleet-service:3007`. That container is crash-looping, so the proxy has no upstream.

## Root cause (one sentence)

`FleetModule` registered `jwtAuthGuardProvider()` (needs `FLEETVISION_TOKEN_VERIFIER`) without providing that token, so Nest never boots.

See `root-cause.md`.
