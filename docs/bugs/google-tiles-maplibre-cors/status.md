# Status

**Fixed** in `apps/web-dashboard/src/lib/basemaps.ts`: Google raster sources use `maxzoom: 21` (OSM/Esri/topo capped at their native zooms). MapLibre overzooms instead of fetching missing z=22 tiles.

Requires a **web-dashboard image rebuild** (or `pnpm dev:web`) so the bundled style includes `maxzoom`.
