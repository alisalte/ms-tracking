# Reproduction

1. Sign in to the web dashboard against a live `notification-service`.
2. Open **عملیات → تنظیم قانون** (`/rules`).
3. The page renders `ErrorState` with detail `limit must be <= 100`.
4. Retry repeats the same `GET /api/v1/notification/rules?limit=200` and fails again.

Network: `GET /api/v1/notification/rules?limit=200` → 400 (Zod `pageRequestSchema`).
