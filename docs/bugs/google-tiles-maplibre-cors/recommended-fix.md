# Recommended fix

Solution 1.

Set `maxzoom` on every `BasemapDef` and pass it through `rasterMapStyle` / `applyRasterBasemap`. Google styles use 21 (last zoom that returns JPEG). MapLibre then scales the z=21 tile when the camera is at 22.

After a dashboard rebuild and a hard refresh, zooming all the way in on Geofences should show satellite (slightly overzoomed) with no `mt*.google.com` z=22 requests.
