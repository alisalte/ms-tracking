# Use cases

## UC-01 — View fuel events

1. User opens Fuel analytics, picks vehicle + date range.
2. Sees refill / drop / level / manual events chronologically.

## UC-02 — Manual refill

1. Driver fueled without sensor; admin enters liters + time + vehicle.
2. Event appears in list and feeds summary.

## UC-03 — Consumption summary

1. User selects fleet or vehicle + last 30 days.
2. Sees liters filled, estimated used, optional L/100km.

## UC-04 — Anomaly review

1. Rapid drop is flagged.
2. User opens detail; may correlate with `fuel-theft` alarm if present.

## UC-05 — Export

1. User exports CSV of summary for accounting / ops.
