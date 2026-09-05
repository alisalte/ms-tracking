# Reproduction

1. Open the dashboard at `http://localhost:8080`.
2. Sign in and go to **Geofences** (or Map) with a Google basemap (`google-satellite` is enough).
3. Zoom in to the map’s maximum (scroll / pinch until z≈22).
4. DevTools → Console: CORS + `AJAXError: Failed to fetch (0)` on `mt*.google.com/vt/…&z=22`.
5. Network: those z=22 requests are 404 `text/html` with **no** `Access-Control-Allow-Origin`. z=21 of the same tile is `200 image/jpeg` with `Access-Control-Allow-Origin: *`.
