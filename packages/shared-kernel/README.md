# @fleetvision/shared-kernel

The FleetVision **Shared Kernel** — DDD primitives, base types, branded identifiers, and the ubiquitous-language value objects shared by 2+ bounded contexts. Pure TypeScript: **no framework imports** (Codebase Architecture §9).

## What lives here

| Export | Purpose |
|---|---|
| `AggregateRoot`, `Entity`, `ValueObject` | DDD base classes |
| `DomainEvent` | CloudEvents-aligned domain event base (01 §6.2) |
| `defineId`, `asId`, `Brand` | Branded identifiers — prevents "wrong id" bugs at compile time |
| `Result`, `isOk` | Never-throw-for-expected-outcomes result type |
| `Money`, `GeoPoint` | Shared value objects (currency, coordinates) |
| `DomainError`, `ErrorCodes`, `HttpStatusByCode` | Canonical error catalog (API_Design §8.3) |
| `Page`, `Cursor`, `encodeCursor`, `decodeCursor` | Cursor-based pagination |
| `TenantId`, `TenantContext` | Tenant identity — INV-I02 (derived from JWT, never request body) |

## Governance

Adding to this package requires ARB review. A concept belongs here only if it is **genuinely shared** (2+ bounded contexts) **and** **stable** (part of the ubiquitous language). Single-context concepts belong in that context's domain layer, not here.

## Build

```bash
pnpm --filter @fleetvision/shared-kernel build
```
