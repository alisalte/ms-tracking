import { describe, expect, it } from '@jest/globals';
import sharp from 'sharp';

import { compressEvidencePhoto } from '../infrastructure/media/evidence-photo-compressor.js';

async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7919) % 251;
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe('compressEvidencePhoto', () => {
  it('scales a full-size snapshot down to a small JPEG', async () => {
    const original = await noisyJpeg(1280, 720);
    const out = await compressEvidencePhoto(original, { maxEdge: 640, quality: 50 });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(360);
    expect(out.length).toBeLessThan(original.length / 3);
  });

  it('keeps the original bytes when they are not a decodable image', async () => {
    const junk = Buffer.from('jpeg');
    expect(await compressEvidencePhoto(junk, { maxEdge: 640, quality: 50 })).toBe(junk);
  });

  it('is a no-op when disabled', async () => {
    const original = await noisyJpeg(64, 64);
    expect(await compressEvidencePhoto(original, { maxEdge: 0, quality: 50 })).toBe(original);
  });
});
