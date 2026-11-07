/**
 * HTTP client for face-service (apps/face-service): one JPEG in, one face
 * embedding out; or one frame of a live RTSP stream out. The service holds no
 * state; matching happens here.
 */

export interface FaceEmbedding {
  /** Detector confidence 0..1. */
  readonly score: number;
  /** L2-normalised feature vector. */
  readonly embedding: number[];
}

export interface FaceEmbedder {
  /** null when the photo holds no usable face. Throws when the service fails. */
  embed(jpeg: Buffer): Promise<FaceEmbedding | null>;
}

export interface FrameGrabber {
  /** One JPEG frame of a live RTSP stream; null when the stream is not live. */
  grab(rtspUrl: string): Promise<Buffer | null>;
}

interface EmbedResponse {
  readonly face?: { readonly score?: number } | null;
  readonly embedding?: number[] | null;
}

export class HttpFaceClient implements FaceEmbedder, FrameGrabber {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 15_000,
  ) {}

  public async embed(jpeg: Buffer): Promise<FaceEmbedding | null> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageBase64: jpeg.toString('base64') }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 400) return null; // undecodable image — nothing to recognise
    if (!res.ok) throw new Error(`face-service HTTP ${res.status}`);
    const body = (await res.json()) as EmbedResponse;
    if (!body.face || !Array.isArray(body.embedding) || body.embedding.length === 0) return null;
    return { score: Number(body.face.score ?? 0), embedding: body.embedding.map(Number) };
  }

  public async grab(rtspUrl: string): Promise<Buffer | null> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: rtspUrl }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 404) return null; // stream not (yet) live
    if (!res.ok) throw new Error(`face-service snapshot HTTP ${res.status}`);
    const body = (await res.json()) as { imageBase64?: unknown };
    if (typeof body.imageBase64 !== 'string' || body.imageBase64.length === 0) return null;
    return Buffer.from(body.imageBase64, 'base64');
  }
}
