# Affected modules

- `apps/web-dashboard/src/lib/basemaps.ts` — raster source `maxzoom` for every MapLibre surface.
- Consumers (no zoom logic of their own): `FleetMap`, `GeofenceDrawMap`, `GeofencePreviewMap`, `TripReplayMap`, `AlarmMap`, `FleetMapPreviewCard`.
