# Bug: overview map on `/geofences` does not show selected areas

## summary
The list-page preview map showed name labels only. Circle and polygon interiors were missing, so a fence that looked selected on the draw map disappeared after save.

## reproduction
1. Open `http://localhost:8080/geofences`.
2. Observe existing fences: labels (`Test`, `yyy`, …) appear; no fill or outline.
3. Create a polygon in the draw dialog (interior highlights correctly) and save.
4. The overview map still shows only a label, not the selected interior.

## root-cause
HTML markers sit above the map. MapLibre fill/line layers were composited **under** the opaque raster basemap, so WebGL geometry was invisible. Unselected fill opacity (0.16) would also vanish on satellite tiles even if layer order were correct. Clicking a row only highlighted while the detail modal covered the overview.

## recommended-fix
1. Raise preview overlay layers above `basemap` after every `setData`.
2. Paint interiors with an SVG overlay (same approach as the draw map).
3. Keep the selected fence highlighted on the overview after create/save and after closing the detail dialog; fit the camera to that ring.

## status
Fixed in `GeofencePreviewMap` + `GeofencePage` selection wiring.
