# new-service generator (Sprint 1 scaffold — non-functional)

Stamps the 17 remaining services (beyond `identity-service`) from the same
per-service shape, so every service boots identically (config → logger → health
→ persistence → redis → graceful shutdown) per Codebase Architecture §4/§14.

## Status

**Sprint 1: scaffold only.** This template documents the target shape; it is
NOT wired to plop/plopjs yet (explicitly out of scope for Sprint 1 — see the
Sprint 1 plan, Deliverable 6). It lands as a working generator in Sprint 2+.

## Target shape (what each new service gets)

```
apps/<service>/
  src/
    main.ts            # identical bootstrap to identity-service
    app.module.ts      # composes the cross-cutting modules
    config/<service>.config.ts   # zod schema extending baseConfigSchema
    api/health/        # mounted via @fleetvision/health
    infrastructure/
      persistence/     # knex repos
      cache/           # cache adapters
      database/migrations/
  Dockerfile           # multi-stage distroless non-root
  nest-cli.json
  tsconfig.json
  package.json         # workspace:* deps
  README.md
  jest.config.js
```

## Planned invocation (Sprint 2)

```
pnpm gen:service <name>      # → plop, against plopfile.js + templates/
```
