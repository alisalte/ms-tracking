# Open questions

Answer these to approve SRS (recommended defaults in bold).

## Critical

| # | Question | Recommended default |
|---|----------|---------------------|
| 1 | Confirm **build in-repo** CMMS core (not Pargar/Alka sync first)? | **Yes — build** |
| 2 | Status model: architecture `OPEN/ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED` vs UI draft `draft/submitted/...`? | **Architecture enums** |
| 3 | PM due generation: **auto job** vs **manual “Generate WO”** on due row? | **Auto job + manual override** |
| 4 | Odometer source for PM? | **Fleet/reporting vehicle meters** (best effort) |

## Important

| # | Question | Recommended default |
|---|----------|---------------------|
| 5 | Assignee: free text vs IAM user? | **Optional user id + display name** |
| 6 | Viewer role gets `maintenance.read`? | **Yes** |
| 7 | Costs required? | **Optional fields** |
| 8 | Keep Pargar/Alka cards on page? | **Yes, secondary** |

## Optional

| # | Question | Recommended default |
|---|----------|---------------------|
| 9 | Attachments on WO in v1? | **No** (later) |
| 10 | Vehicle auto “out of service” on open WO? | **No** (later) |

## How to approve

Reply e.g. **«نیازمندی‌ها تأیید — پیش‌فرض‌ها»** or list overrides for #1–4.
