# Reproduction

1. Open **دارایی‌ها → رانندگان** (`/assets?tab=drivers`).
2. The page shows `Request failed with status code 502`.
3. `docker ps` shows `fleetvision-fleet` as `Restarting`.
4. `docker logs fleetvision-fleet` contains:

```
Nest can't resolve dependencies of the JwtAuthGuard (?, FLEETVISION_REVOCATION_CHECKER, FLEETVISION_PERMISSION_RESOLVER).
Please make sure that the argument "FLEETVISION_TOKEN_VERIFIER" at index [0] is available in the FleetModule context.
```
