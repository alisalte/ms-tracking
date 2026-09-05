# Possible solutions

1. **Set raster `maxzoom` to the provider’s native ceiling** (Google 21, OSM 19, Esri imagery 19, Esri dark 16, OpenTopo 17). MapLibre overzooms past that instead of fetching missing tiles. Matches the style spec.
2. **Same-origin nginx/Vite proxy** for Google tiles. Would turn Google’s 404 HTML into a same-origin 404 (no CORS spam) but does not stop MapLibre asking for z=22, and 200 tiles already send `ACAO: *`.
3. **Cap the Map view** with `map.setMaxZoom(21)`. Stops the operator at 21; worse than overzooming a sharp z=21 tile to 22.
4. **Switch the default basemap to OSM/Esri.** OSM also 404s above 19; same class of bug unless `maxzoom` is set.

Rejected as the primary fix: a Google tile proxy. The CORS message was a 404 in disguise, not Google blocking 200 responses.
