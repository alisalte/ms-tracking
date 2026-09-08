# Current state

Evidence also cross-checked via codebase explore ([Explore driver-device links](74fe7f11-8036-40b3-b31e-8063df3f5d35)).

## Fleet registry

- `fleet-service` drivers: profile + **single** `assigned_vehicle_id` / `assigned_at`  
  (migration `apps/fleet-service/src/infrastructure/database/migrations/20260401000000_create_fleet_schema.js`).
- Assign / unassign APIs: `POST .../assign-vehicle`, `.../unassign-vehicle` (`drivers.controller.ts`).
- **No** `driver_assignments` history table; reassignment overwrites the pointer.
- Devices bind via `fleet.vehicle_devices` (also current-oriented). UI join: `apps/web-dashboard/src/components/assets/driver-join.ts`.
- **No** `apps/driver-management-service` — `docs/modules/Driver-Management.md` is aspirational.

## UI

- Assets → Drivers: `DriversTab.tsx` + detail/assign in `AssetDetailDrawers.tsx`.
- Map popup: current driver via `driverOnVehicle` (`DevicePopup.tsx`).
- Reports → Drivers: `DriversSection.tsx` rolls `/reports/vehicle-meters` for the **currently** assigned vehicle. i18n already warns hours/distance come from that vehicle. Phase 8 notes a true driver-activity report was **deliberately not built** (`docs/tailadmin/PHASE_8_REPORTING.md`).

## Alarms

- `notification.alerts` / `AlarmOccurrence`: `vehicle_id` (+ detail JSON) — **no `driver_id` column**.
- UI `Alarm.driver?: string` is optional display only (`alarm.types.ts` / `mapAlarm`).
- Templates may interpolate `driverName`; not a persisted FK.

## Trips

- `fleet.business_trips` optional `driver_id` + `vehicle_id` (planned fleet trips, not GPS trip FSM).
- GPS engine trips: vehicle/time; no driver fields.

## Spec (aspirational)

`docs/specs/02_Domain_Model.md` + `docs/modules/Driver-Management.md`: `DriverAssignment`, HOS, behavior score — not implemented as a running BC.
