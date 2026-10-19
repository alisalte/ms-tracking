import type { Map as MaplibreMap } from 'maplibre-gl';

/**
 * Run `fn` as soon as the map style can accept sources/layers/markers.
 *
 * `map.loaded()` alone is not a safe gate: it stays `false` while ANY tile is
 * still streaming, and the `'load'` event fires exactly ONCE (after the first
 * complete render). An effect that runs after that — e.g. a track fetched
 * asynchronously — would wait on `once('load')` forever and never render.
 * A loaded STYLE is sufficient for addSource/addLayer/marker work.
 *
 * `styledata` can fire before the style is usable. A one-shot listener that
 * bails on that first event never retries, so overlays stay missing and the
 * camera never leaves the default city. Keep listening until the style is
 * actually ready (or the one-shot `load` arrives).
 */
export function runWhenStyleReady(map: MaplibreMap, fn: () => void): void {
  if (styleReady(map)) {
    fn();
    return;
  }
  let ran = false;
  const run = (event?: { type?: string }) => {
    if (ran) return;
    if (event?.type !== 'load' && !styleReady(map)) return;
    ran = true;
    map.off('load', run);
    map.off('styledata', run);
    fn();
  };
  map.on('load', run);
  map.on('styledata', run);
}

function styleReady(map: MaplibreMap): boolean {
  try {
    return Boolean(map.loaded() || map.isStyleLoaded());
  } catch {
    return false;
  }
}
