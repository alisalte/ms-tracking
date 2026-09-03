# Lessons learned

- `AuthModule.forRoot` is the HTTP auth path. `jwtAuthGuardProvider` + `TOKEN_VERIFIER` is a separate composable path; using one without the other crashes boot.
- A 502 on a dashboard collection page is often an upstream that never listened, not a frontend bug.
- nginx is written to boot without the upstream (`set $fleet_svc_upstream`); missing process still yields 502, not a compose-time error.
