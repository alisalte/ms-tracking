# Database impact

## New (v1)

Schema: prefer **`fuel`** (matches architecture) with grants to fleet-service + reporting-service read, **or** `fleet.fuel_events` if cross-schema grants are painful — decide at implement time; recommendation: **`fuel.fuel_events`**.

```
fuel.fuel_events (
  id uuid PK,
  tenant_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  device_id text NULL,
  kind text NOT NULL,          -- refill | drop | level | manual
  source text NOT NULL,        -- device | manual
  device_code text NULL,       -- FUEL_*
  volume_liters numeric NULL,
  odometer_km numeric NULL,
  cost numeric NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  created_by uuid NULL,
  alarm_id uuid NULL           -- optional link
)
Indexes: (tenant_id, vehicle_id, occurred_at DESC), (tenant_id, kind, occurred_at)
RLS / tenant checks consistent with fleet tables.
```

Optional later: `fuel.fuel_anomalies` — can be a view/filter on `kind=drop` + `device_code=FUEL_THEFT`.

## Out of v1

`fuel_cards`, `fuel_transactions` (card purchase), `fuel_stations`, daily ML tables.
