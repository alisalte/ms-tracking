/**
 * ByteReader — a pull-based streaming reader over a sequence of inbound buffers
 * (06 §10.1). Each adapter implements `frame(reader)` as a streaming parser that
 * consumes bytes via this abstraction, applies the protocol framing rule
 * (length-prefix, delimiter, byte-stuffing), and emits complete RawPackets.
 *
 * Design: the reader holds an append-only byte queue. Adapters call `peek`/`read`
 * to inspect or consume; partial frames simply return a `NEED_MORE` sentinel so
 * the transport knows to await the next socket chunk. This keeps framing at one
 * layer — the transport never buffers incomplete packets itself (06 §10.1).
 */
/** Returned when a parser needs more bytes to complete a frame. */
export const NEED_MORE = Symbol('NEED_MORE');
export type NeedMore = typeof NEED_MORE;

/**
 * In-memory byte queue with peek/read primitives. Not concurrency-protected —
 * each connection owns its own reader and processes frames single-threaded on
 * the event loop (06 §3.2).
 */
export class ByteReader {
  private readonly chunks: Buffer[] = [];
  private length = 0;

  /** Append a chunk from the socket. */
  public append(chunk: Buffer): void {
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.length += chunk.length;
    }
  }

  /** Total bytes currently buffered. */
  public get available(): number {
    return this.length;
  }

  /** True iff no bytes are buffered. */
  public get isEmpty(): boolean {
    return this.length === 0;
  }

  /**
   * Peek up to `n` bytes from the head without consuming. Returns fewer if the
   * queue holds less than `n`. Never throws.
   */
  public peek(n: number): Buffer {
    if (n <= 0 || this.length === 0) return Buffer.alloc(0);
    if (n >= this.length) return this.compacted();
    // Copy only as many bytes as needed from the leading chunks.
    const out = Buffer.allocUnsafe(n);
    let written = 0;
    for (const chunk of this.chunks) {
      if (written >= n) break;
      const toCopy = Math.min(chunk.length, n - written);
      chunk.copy(out, written, 0, toCopy);
      written += toCopy;
    }
    return out.subarray(0, written);
  }

  /** Consume and return exactly `n` bytes, or NEED_MORE if fewer are available. */
  public read(n: number): Buffer | NeedMore {
    if (this.length < n) return NEED_MORE;
    const out = Buffer.allocUnsafe(n);
    let written = 0;
    while (written < n) {
      const chunk = this.chunks[0];
      if (!chunk) break;
      const toCopy = Math.min(chunk.length, n - written);
      chunk.copy(out, written, 0, toCopy);
      written += toCopy;
      if (toCopy === chunk.length) {
        this.chunks.shift();
      } else {
        this.chunks[0] = chunk.subarray(toCopy);
      }
    }
    this.length -= written;
    return out.subarray(0, written);
  }

  /** Drop all buffered bytes (e.g. on protocol resync). */
  public clear(): void {
    this.chunks.length = 0;
    this.length = 0;
  }

  /** Flatten the queue into one buffer (for peek-all / debugging). */
  private compacted(): Buffer {
    if (this.chunks.length === 1) return this.chunks[0] ?? Buffer.alloc(0);
    if (this.chunks.length === 0) return Buffer.alloc(0);
    const merged = Buffer.concat(this.chunks, this.length);
    this.chunks.length = 0;
    this.chunks.push(merged);
    return merged;
  }
}
