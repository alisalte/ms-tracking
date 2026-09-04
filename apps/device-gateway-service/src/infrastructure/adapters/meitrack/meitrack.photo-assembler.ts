/**
 * PhotoAssembler — reassembles D00 photo-chunk messages (meitrack.decode.ts
 * decodePhotoChunk) into a complete image.
 *
 * The Meitrack adapter must stay stateless (ProtocolAdapter contract doc: "an
 * adapter instance is shared across all connections of its protocol"), so this
 * reassembler lives outside it — instantiate ONE per device (or per capture)
 * in whatever consumes PHOTO DeviceMessages downstream (mirrors
 * AccessUnitAssembler in apps/mdvr-streamer-service/src/nal.ts, which
 * reassembles the analogous video-plane chunks the same way).
 *
 * Ported from the validated reference (md300/server/capture_photo.py): buffer
 * chunks by packet index for a filename; once as many chunks as
 * `totalPackets` have arrived, concatenate them in index order.
 */

export interface PhotoChunkInput {
  readonly filename: string;
  readonly totalPackets: number;
  readonly packetIndex: number;
  /** Chunk payload, base64 — matches decodePhotoChunk's telemetry.chunkBase64. */
  readonly chunkBase64: string;
}

export type FeedPhotoChunkResult =
  | { readonly status: 'pending'; readonly received: number; readonly total: number }
  | { readonly status: 'complete'; readonly filename: string; readonly data: Buffer };

interface PendingDownload {
  total: number;
  parts: Map<number, Buffer>;
}

export class PhotoAssembler {
  private readonly downloads = new Map<string, PendingDownload>();

  /**
   * Feed one chunk. Returns `complete` with the reassembled bytes once every
   * packet index for that filename has arrived; `pending` otherwise. A
   * `totalPackets` mismatch (device restarted the capture) resets that
   * filename's buffer.
   */
  public feed(chunk: PhotoChunkInput): FeedPhotoChunkResult {
    let dl = this.downloads.get(chunk.filename);
    if (!dl || dl.total !== chunk.totalPackets) {
      dl = { total: chunk.totalPackets, parts: new Map() };
      this.downloads.set(chunk.filename, dl);
    }
    dl.parts.set(chunk.packetIndex, Buffer.from(chunk.chunkBase64, 'base64'));

    if (dl.total > 0 && dl.parts.size >= dl.total) {
      const ordered = [...dl.parts.keys()].sort((a, b) => a - b);
      const data = Buffer.concat(ordered.map((k) => dl.parts.get(k) as Buffer));
      this.downloads.delete(chunk.filename);
      return { status: 'complete', filename: chunk.filename, data };
    }
    return { status: 'pending', received: dl.parts.size, total: dl.total };
  }

  /** Drop all in-flight downloads (device disconnect / resync). */
  public reset(): void {
    this.downloads.clear();
  }
}
