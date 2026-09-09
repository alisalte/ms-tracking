# Business rules

## Confirmed

| ID | Rule |
|----|------|
| BR-01 | CMMS is out of this feature; Fuel does not create work orders in v1. |
| BR-02 | Full fuel-card CRM is out of v1. |

## Proposed (awaiting approval)

| ID | Rule | Proposed default |
|----|------|------------------|
| BR-10 | Canonical volume unit | **Liters** |
| BR-11 | Rapid drop anomaly | Drop ≥ **X% of tank** or ≥ **Y liters** within **T minutes** while vehicle stationary or ignition off (exact X/Y/T in analysis; suggested 10% / 20 L / 15 min) |
| BR-12 | Manual refill | Allowed; marked `source=manual`; counts toward consumption |
| BR-13 | Double-count | Same device refill event + matching manual within ±30 min → prefer device, soft-dedupe or warn |
| BR-14 | L/100km | Only when distance in range is available from trips/tracking meters; else show liters only |
| BR-15 | Permissions | `fuel.read` / `fuel.write`; fleet-admin both; viewer read optional |
| BR-16 | Device volume | Meitrack v1: `FUEL_*` events may have **null** `volume_liters`; liters for summaries come from **manual** (or future decode) |

## Locked scope note

Stakeholder locked product scope 2026-09-09 (events + summary + anomaly + Reports UI; no cards/billing).

## Changelog

- 2026-09-09: Draft.
