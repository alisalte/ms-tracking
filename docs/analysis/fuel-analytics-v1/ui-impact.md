# UI impact

| Change | File / area |
|--------|-------------|
| Add section `fuel` | `report-sections.ts` (ops group) |
| Wire section | `ReportsPage.tsx` |
| New `FuelSection.tsx` | Events table + summary KPIs + manual refill form (if fuel.write) + empty state |
| API hooks | `fuel.api.ts` or extend `report.api.ts` |
| i18n EN/FA | `common.json` report catalog + fuel labels |
| Permissions | `permissions.tsx` keys for fuel.read/write |
| Optional | Link from alarm drawer `fuel-theft` → `/reports?section=fuel&vehicleId=` |

No dedicated top-level `/fuel` route in v1 unless product insists (locked: Reports).
