# Lessons learned

- A CORS error on a tile URL is not always “this host has no CORS.” Check the status and content-type: Google’s **404 HTML** omits `Access-Control-Allow-Origin`, while **200 JPEG** tiles send `*`.
- MapLibre raster `maxzoom` defaults to 22. Any provider that stops earlier (Google 21, OSM 19) will spam the console at max camera zoom unless the source declares its native ceiling.
- Chrome `runtime.lastError` / “message port closed” on `login?redirect=` is almost always an extension, not an app bug.
