/**
 * Driver photos — pure rules for the cabin snapshot that identifies a driver.
 *
 * A snapshot's face embedding (L2-normalised, from face-service) is compared
 * with every CONFIRMED photo of every driver. A driver's score is the best
 * similarity among their photos. The snapshot is filed automatically only
 * when the best driver clears `threshold` AND beats the runner-up by
 * `margin` — two drivers that look alike leave the photo for an operator.
 */

export type DriverPhotoTrigger = 'IGNITION' | 'CONNECT' | 'MANUAL';
export type DriverPhotoStatus = 'PENDING' | 'CAPTURING' | 'DOWNLOADING' | 'READY' | 'FAILED';
export type DriverFaceStatus = 'PENDING' | 'FOUND' | 'NO_FACE' | 'ERROR';
export type DriverMatchStatus = 'UNASSIGNED' | 'AUTO' | 'CONFIRMED';

export interface FaceReference {
  readonly driverId: string;
  readonly embedding: readonly number[];
}

export interface FaceMatchOptions {
  /** Minimum cosine similarity for the best driver. */
  readonly threshold: number;
  /** Minimum lead of the best driver over the second best. */
  readonly margin: number;
}

export interface FaceMatchResult {
  /** Driver to file the photo under, or null when no driver is certain enough. */
  readonly driverId: string | null;
  /** Best driver's similarity (also set when the match was not certain enough). */
  readonly score: number | null;
  readonly bestDriverId: string | null;
  readonly runnerUpScore: number | null;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function matchFace(
  embedding: readonly number[],
  references: readonly FaceReference[],
  options: FaceMatchOptions,
): FaceMatchResult {
  const best = new Map<string, number>();
  for (const ref of references) {
    if (ref.embedding.length !== embedding.length) continue;
    const score = cosineSimilarity(embedding, ref.embedding);
    const prev = best.get(ref.driverId);
    if (prev === undefined || score > prev) best.set(ref.driverId, score);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const first = ranked[0];
  if (!first) return { driverId: null, score: null, bestDriverId: null, runnerUpScore: null };
  const runnerUp = ranked[1]?.[1] ?? null;
  const certain =
    first[1] >= options.threshold && (runnerUp === null || first[1] - runnerUp >= options.margin);
  return {
    driverId: certain ? first[0] : null,
    score: first[1],
    bestDriverId: first[0],
    runnerUpScore: runnerUp,
  };
}

/** Delay before retrying a failed capture step, by attempt number (1-based). */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(300, 30 * 2 ** Math.max(0, attempt - 1));
}

/** Total capture tries per photo before it is marked FAILED. */
export const MAX_DRIVER_PHOTO_ATTEMPTS = 3;
