# Affected modules

| Module | Role |
| --- | --- |
| `apps/web-dashboard/src/api/rule.api.ts` | `fetchAllRules()` sent `limit: 200` |
| `apps/web-dashboard/src/pages/AlarmRulesPage.tsx` | Surfaces the API error via `ErrorState` |
| `apps/notification-service/src/api/rules.controller.ts` | `GET /` uses `pageRequestSchema` |
| `packages/auth/src/validation-schemas.ts` | `.max(MAX_PAGE_SIZE)` → `"limit must be <= 100"` |
| `packages/shared-kernel/src/types/pagination.ts` | `MAX_PAGE_SIZE = 100` |

Same client pattern (same 400 on `pageRequestSchema` endpoints):

| Module | Endpoint |
| --- | --- |
| `apps/web-dashboard/src/api/driver.api.ts` | `GET /fleet/drivers` (`fleet-service`) |

Not this bug (those backends allow ≥200):

- `asset.api.ts` / `command.api.ts` — fleet-management `listQuerySchema.max(200)`
- `admin.api.ts` audit — identity clamps to 500
