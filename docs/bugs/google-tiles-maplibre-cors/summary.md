# Bug: Google basemap tiles fail on Geofences (and every MapLibre surface)

## Summary

Console on `http://localhost:8080/geofences` shows CORS errors against

`https://mt0.google.com/vt/lyrs=s&hl=fa&x=…&y=…&z=22`

and MapLibre `AJAXError: Failed to fetch (0)`. The satellite layer looks blank at high zoom.

`Unchecked runtime.lastError: The message port closed…` is a Chrome extension message-port warning. It is unrelated.

## Root cause (one sentence)

MapLibre raster sources default to `maxzoom: 22`, Google has no z=22 tiles (404 HTML **without** CORS headers), so the browser reports a CORS failure instead of a quiet 404 and MapLibre will not overzoom from z=21.

See `root-cause.md`.
