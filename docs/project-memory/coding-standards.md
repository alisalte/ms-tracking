# Coding Standards

**Canonical:** `docs/specs/22_Codebase_Architecture.md`, ADR-021

- TypeScript strict (`strictNullChecks`, `noImplicitAny`).
- Lint/format: Biome. Tests: Jest (services + web-dashboard).
- One NestJS module per aggregate; knex (not a heavy ORM) for persistence.
- UI copy via i18n (`en` + `fa`); do not hard-code operator-facing strings.
- Do not import another service's internals; use Kafka / published packages.
- Device protocol knowledge lives in `device-gateway-service` adapters and `meitrack-command-catalog.ts` — keep encode/decode aligned.

## Changelog

- 2026-09-07: Initial standards snapshot.
