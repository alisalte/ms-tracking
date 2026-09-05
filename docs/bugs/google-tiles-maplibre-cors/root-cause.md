# Root cause

## What the console shows

Every failing URL in the report is **z=22** Google satellite (`lyrs=s`). MapLibre 6 loads raster tiles with `fetch`. A raster source with no `maxzoom` defaults to **22**, so a view zoomed to 22 requests z=22 tiles.

## What Google actually returns

Probed the same tile pyramid the console cited (`x=2695214, y=1651342` at z=22, parents via `x>>dz`):

| z | status | content-type | Access-Control-Allow-Origin |
|---|--------|----------------|------------------------------|
| 16–21 | 200 | image/jpeg | `*` |
| 22 | 404 | text/html | **missing** |

Successful Google tiles already allow cross-origin reads. The 404 **error page** does not. The browser therefore hides the 404 behind `blocked by CORS policy` / `net::ERR_FAILED`, and MapLibre logs `AJAXError: Failed to fetch (0)`.

Leaflet would still paint parents via `<img>`; MapLibre will not overzoom unless `maxzoom` tells it the native ceiling.

## Unrelated noise

`Unchecked runtime.lastError: The message port closed before a response was received` / `Receiving end does not exist` is a Chrome extension `chrome.runtime` port, not this SPA.
