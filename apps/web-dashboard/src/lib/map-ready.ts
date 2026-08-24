import type { Map as MaplibreMap } from 'maplibre-gl';

/**
 * Run `fn` as soon as the map style can accept sources/layers/markers.
 *
 * `map.loaded()` alone is not a safe gate: it stays `false` while ANY tile is
 * still streaming, and the `'load'` event fires exactly ONCE (after the first
 * complete render). An effect that runs after that — e.g. a track fetched
 * asynchronously — would wait on `once('load')` forever and never render.
 * A loaded STYLE is sufficient for addSource/addLayer/marker work, so fall
 * back to the repeating `styledata` event when the one-shot `'load'` may
 * already have fired.
 */
export function runWhenStyleReady(map: MaplibreMap, fn: () => void): void {
  if (map.loaded() || map.isStyleLoaded()) {
    fn();
    return;
  }
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    fn();
  };
  map.once('load', run);
  map.once('styledata', () => {
    if (map.isStyleLoaded() || map.loaded()) run();
  });
}
