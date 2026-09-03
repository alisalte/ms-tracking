# Lessons learned

- Dashboard fetch-all helpers copied `PAGE_SIZE = 200` from fleet-management (`listQuerySchema.max(200)`). Services on `pageRequestSchema` cap at 100 and **reject**.
- `use-cursor-pagination.ts` already documented the 100 cap; the fetch-all helpers did not share that constant.
- A test named "clamps limit above MAX" in `validation-schemas.spec.ts` actually expects **reject**. Name and behavior drifted; do not assume clamping from the test title.
