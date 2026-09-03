# Recommended fix

Use option 1.

- Add dashboard `MAX_PAGE_SIZE = 100` (same number as shared-kernel; web-dashboard does not depend on that package).
- `rule.api.ts` and `driver.api.ts`: `PAGE_SIZE = MAX_PAGE_SIZE`.
- Keep the existing cursor-follow loop.
- Pin the wire contract with a test that `GET /notification/rules` is called with `limit: 100`.

Do not raise the backend max or silently clamp at the HTTP boundary for this bug.
