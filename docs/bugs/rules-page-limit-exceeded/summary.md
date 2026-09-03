# Bug: Alert rules page fails with `limit must be <= 100`

## Summary

Opening **تنظیم قانون** (`/rules`) shows:

```
خطایی رخ داد
limit must be <= 100
```

The dashboard list fetcher requested `limit=200`. `notification-service` `GET /api/v1/notification/rules` validates query params with `pageRequestSchema`, which rejects any `limit > MAX_PAGE_SIZE` (100).

## Root cause (one sentence)

`rule.api.ts` followed cursor pages with `PAGE_SIZE = 200`, but `pageRequestSchema.max(MAX_PAGE_SIZE)` is 100 and rejects rather than clamping.

See `root-cause.md`.
