/**
 * Pure orthophoto helpers: signed tile tokens and XYZ / Web-Mercator maths.
 *
 * Map tiles are fetched by MapLibre without an Authorization header, so tile
 * URLs carry an HMAC token bound to one tenant + orthophoto. The expiry is
 * bucketed to whole days so URLs stay stable and browsers can cache tiles.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const DAY_SECONDS = 86_400;
const MERCATOR_HALF = 20037508.342789244;
/** Metres per pixel at zoom 0 for 256px Web-Mercator tiles. */
const ZOOM0_RESOLUTION = (MERCATOR_HALF * 2) / 256;

export interface TileTokenClaims {
  readonly tenantId: string;
  readonly orthophotoId: string;
  readonly exp: number;
}

function hmac(secret: string, payload: string): Buffer {
  return createHmac('sha256', `orthophoto-tile:${secret}`).update(payload).digest();
}

/** Expiry 1–2 days ahead, on a day boundary. */
export function tileTokenExpiry(nowSeconds: number): number {
  return (Math.floor(nowSeconds / DAY_SECONDS) + 2) * DAY_SECONDS;
}

export function signTileToken(secret: string, claims: TileTokenClaims): string {
  const payload = `${claims.tenantId}.${claims.orthophotoId}.${claims.exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${hmac(secret, payload).toString('base64url')}`;
}

/** Returns the claims, or null for a malformed, forged or expired token. */
export function verifyTileToken(
  secret: string,
  token: string,
  nowSeconds: number,
): TileTokenClaims | null {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra !== undefined) return null;
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = hmac(secret, payload);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const [tenantId, orthophotoId, expRaw] = payload.split('.');
  const exp = Number(expRaw);
  if (!tenantId || !orthophotoId || !Number.isFinite(exp) || exp <= nowSeconds) return null;
  return { tenantId, orthophotoId, exp };
}

export function isValidTile(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 26) return false;
  const size = 2 ** z;
  return x >= 0 && y >= 0 && x < size && y < size;
}

/** Web-Mercator bounds of an XYZ tile. */
export function tileBounds(z: number, x: number, y: number) {
  const span = (MERCATOR_HALF * 2) / 2 ** z;
  return {
    minX: -MERCATOR_HALF + x * span,
    maxX: -MERCATOR_HALF + (x + 1) * span,
    maxY: MERCATOR_HALF - y * span,
    minY: MERCATOR_HALF - (y + 1) * span,
  };
}

/** Zoom whose tile resolution is closest to the raster's metres-per-pixel. */
export function nativeZoom(metresPerPixel: number): number {
  return Math.min(26, Math.max(0, Math.round(Math.log2(ZOOM0_RESOLUTION / metresPerPixel))));
}

export interface LngLatBounds {
  readonly minLng: number;
  readonly minLat: number;
  readonly maxLng: number;
  readonly maxLat: number;
}

/** Bounding box of GDAL's `wgs84Extent` polygon; null when it is unusable. */
export function boundsFromExtent(extent: unknown): LngLatBounds | null {
  const ring = (extent as { coordinates?: [number, number][][] } | null)?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  if (![...lngs, ...lats].every(Number.isFinite)) return null;
  return {
    minLng: Math.min(...lngs),
    minLat: Math.min(...lats),
    maxLng: Math.max(...lngs),
    maxLat: Math.max(...lats),
  };
}

/**
 * Percent done from the tail of a GDAL utility's stdout ("0...10...20.."):
 * each number is a tenth, each dot after it another 2.5 %.
 */
export function gdalProgress(tail: string): number | null {
  const m = /(\d{1,3})(\.{0,3})(?: - done\.?)?\s*$/.exec(tail);
  if (!m) return null;
  const pct = Number(m[1]) + 2.5 * (m[2]?.length ?? 0);
  return pct <= 100 ? pct : null;
}

/** Last "NN.NN%" in the tail of ecw2tiff --progress stderr. */
export function percentProgress(tail: string): number | null {
  const all = [...tail.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)];
  const last = all.at(-1);
  if (!last) return null;
  const pct = Number(last[1]);
  return pct <= 100 ? pct : null;
}

/** Strip ecw2tiff's \r-redrawn progress lines so error messages stay readable. */
export function stripProgressLines(text: string): string {
  return text.replace(/\r?[ \t]*\d{1,3}(?:\.\d+)?%[^\r\n]*Mpx\/s[^\r\n]*/g, '');
}

export type ConversionStage = 'queued' | 'decode' | 'mask' | 'cog' | 'publish';

/** Share of the total conversion each stage roughly takes. */
const STAGE_WEIGHTS: Record<Exclude<ConversionStage, 'queued'>, number> = {
  decode: 0.35,
  mask: 0.35,
  cog: 0.28,
  publish: 0.02,
};
const STAGE_ORDER = ['decode', 'mask', 'cog', 'publish'] as const;

/** Overall percent (0–100) given the current stage and how far into it. */
export function overallPercent(stage: ConversionStage, stagePercent: number): number {
  if (stage === 'queued') return 0;
  let done = 0;
  for (const s of STAGE_ORDER) {
    if (s === stage) {
      done += STAGE_WEIGHTS[s] * Math.min(100, Math.max(0, stagePercent));
      break;
    }
    done += STAGE_WEIGHTS[s] * 100;
  }
  return Math.round(done * 10) / 10;
}
