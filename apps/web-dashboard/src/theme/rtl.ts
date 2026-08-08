import createCache, {
  type EmotionCache,
  type Options as EmotionCacheOptions,
} from '@emotion/cache';
import stylisRTLPlugin from 'stylis-plugin-rtl';

/**
 * Emotion cache factories keyed by text direction.
 *
 * MUI v6 recommends per-direction caches: when the app switches to RTL, we use
 * a cache whose Stylis pipeline prepends `stylis-plugin-rtl`, which mirrors
 * every logical CSS property (margin-left → margin-right, etc.). Caches are
 * memoized so we never recreate them on re-render.
 *
 * Source: MUI "RTL" guide + UI_UX_Design.md §0.9 (RTL support).
 */
const cacheByDirection: Partial<Record<'ltr' | 'rtl', EmotionCache>> = {};

function createDirectionCache(direction: 'ltr' | 'rtl'): EmotionCache {
  const stylisPlugins: EmotionCacheOptions['stylisPlugins'] =
    direction === 'rtl' ? [stylisRTLPlugin] : undefined;
  return createCache({
    key: direction === 'rtl' ? 'mui-rtl' : 'mui',
    stylisPlugins,
  });
}

/**
 * Return the (memoized) emotion cache for the given direction.
 */
export function getRtlCache(direction: 'ltr' | 'rtl'): EmotionCache {
  const cached = cacheByDirection[direction];
  if (cached) return cached;
  const cache = createDirectionCache(direction);
  cacheByDirection[direction] = cache;
  return cache;
}
