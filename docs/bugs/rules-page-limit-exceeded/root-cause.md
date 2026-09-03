# Root cause

## Backend contract

`packages/shared-kernel` defines `MAX_PAGE_SIZE = 100`.

`packages/auth` `pageRequestSchema` **rejects** oversized limits (does not clamp):

```ts
limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE, `limit must be <= ${MAX_PAGE_SIZE}`)
```

`RulesController.list` binds `@Query(new ZodValidationPipe(pageRequestSchema))`.

`resolvePageRequest()` in shared-kernel **does** clamp. The HTTP Zod schema does not. A client that assumed clamping gets a 400.

## Client

`fetchAllRules()` walks the cursor chain with `PAGE_SIZE = 200` so the DataTable can stay an in-memory list. The extra 100 over the schema max is enough to fail the first request; no rows are shown.

`driver.api.ts` used the same `PAGE_SIZE = 200` against `fleet-service` drivers, which also uses `pageRequestSchema`.
