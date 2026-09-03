# Possible solutions

1. **Client: request `limit <= 100` and keep cursor follow.** Matches the HTTP schema. Extra round-trips only if there are more than 100 rules. Cursor loop already exists.

2. **Backend: clamp in `pageRequestSchema` instead of rejecting.** Aligns Zod with `resolvePageRequest()`. Hides client mistakes; weaker fail-fast.

3. **Raise `MAX_PAGE_SIZE` to 200.** Wider pages on every collection endpoint. Undoes the shared unbounded-load guard.

4. **Replace fetch-all with `useCursorPagination` + Load more.** Correct long-term UX, larger UI change than needed to unblock this page.
