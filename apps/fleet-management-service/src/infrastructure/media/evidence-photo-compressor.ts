/**
 * Shrinks an alarm snapshot before it is stored. The MD300 sends its full
 * capture over D00; the platform only needs a thumbnail-sized proof, so the
 * JPEG is scaled down and re-encoded (typically 20–40 KB instead of 100+ KB).
 * Any failure keeps the original bytes — evidence must never be lost to it.
 */
import sharp from 'sharp';

export interface EvidencePhotoCompression {
  /** Longest edge in pixels; 0 disables compression. */
  readonly maxEdge: number;
  /** JPEG quality, 1–100. */
  readonly quality: number;
}

export async function compressEvidencePhoto(
  bytes: Buffer,
  opts: EvidencePhotoCompression,
): Promise<Buffer> {
  if (opts.maxEdge <= 0 || bytes.length === 0) return bytes;
  try {
    const out = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({
        width: opts.maxEdge,
        height: opts.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: opts.quality, mozjpeg: true })
      .toBuffer();
    return out.length < bytes.length ? out : bytes;
  } catch {
    return bytes;
  }
}
