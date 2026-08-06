/**
 * Position quality codes + validation gates (07 §3.3, §3.4).
 *
 * Every inbound position runs through these gates in the pipeline. Each gate
 * either passes, tags the position with a degraded quality code, or rejects it.
 * Quality controls downstream behavior (07 §3.4):
 *   VALID       → persist + push live + use in derived metrics.
 *   STALE       → persist + do NOT push live (07: stale misleads the live map).
 *   LOW_ACCURACY→ persist (tagged) + do not use in derived metrics.
 *   SUSPECT_JUMP→ hold for re-evaluation (Sprint 7: tagged + persisted).
 *   REJECTED    → drop (schema/range/future violations).
 */
export type Quality = 'VALID' | 'STALE' | 'LOW_ACCURACY' | 'SUSPECT_JUMP' | 'REJECTED';

/** Numeric quality code stored in the DB (07 §3.4 + migration default). */
export const QUALITY_CODE: Readonly<Record<Quality, number>> = {
  REJECTED: 0,
  VALID: 1,
  STALE: 2,
  LOW_ACCURACY: 3,
  SUSPECT_JUMP: 4,
};

export interface QualityOptions {
  /** Seconds — a position older than this is STALE (default 300, 07 §3.3 CV-3). */
  readonly staleAfterSeconds: number;
  /** Seconds — a position further in the future than this is REJECTED (07 §3.3 CV-3). */
  readonly futureThresholdSeconds: number;
}

/** Result of the validation gates: the assigned quality, or a reject reason. */
export interface ValidationResult {
  readonly quality: Quality;
  /** True when the position should be persisted (not REJECTED). */
  readonly accepted: boolean;
  readonly reason: string | null;
}

/**
 * Run a raw coordinate + timestamp through the validation gates (07 §3.3).
 * Pure function — no side effects, trivially testable.
 *
 * Gates in order: range → future → stale. (Dedupe + jump detection run in the
 * pipeline against prior state; this function covers only the per-position gates.)
 */
export function validatePosition(
  latitude: number,
  longitude: number,
  capturedAt: Date,
  now: Date,
  opts: QualityOptions,
): ValidationResult {
  // CV-2: coordinate sanity range.
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return reject('latitude out of range [-90, 90]');
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return reject('longitude out of range [-180, 180]');
  }

  const ageSeconds = (now.getTime() - capturedAt.getTime()) / 1000;

  // CV-3: future-dated beyond the threshold → reject (clock skew / garbage).
  if (ageSeconds < -opts.futureThresholdSeconds) {
    return reject(`position is ${Math.abs(ageSeconds).toFixed(0)}s in the future`);
  }

  // CV-3: stale → tag STALE (persisted, not pushed live).
  if (ageSeconds > opts.staleAfterSeconds) {
    return {
      quality: 'STALE',
      accepted: true,
      reason: `position is ${ageSeconds.toFixed(0)}s old`,
    };
  }

  return { quality: 'VALID', accepted: true, reason: null };
}

function reject(reason: string): ValidationResult {
  return { quality: 'REJECTED', accepted: false, reason };
}
