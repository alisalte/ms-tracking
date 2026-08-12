/**
 * MediaRouter port — the gRPC-style interface to the media-router/SFU
 * (09 §5.4, registry #11).
 *
 * The media-router is the infra-class SFU component (Pion/mediasoup) that owns
 * the actual RTP sockets, transcoders, and WebRTC tracks. media-service calls it
 * via this port. For Sprint 10 a **stub implementation** returns synthetic SDP —
 * the real SFU is wired when the infra component deploys.
 *
 * This is the same provider-abstraction pattern used by the Map Engine
 * (MapProvider) and the Device Gateway (ProtocolAdapter).
 */
import type { Quality, StreamMode } from '../domain/stream-session.js';

/** A request to create a stream session on the router. */
export interface CreateSessionRequest {
  readonly channelId: string;
  readonly tenantId: string;
  readonly mode: StreamMode;
  readonly quality: Quality;
  /** TTL in seconds (source auto-closes after this with 0 viewers). */
  readonly ttlSeconds: number;
}

/** The router's response: SDP offer for WebRTC negotiation. */
export interface CreateSessionResponse {
  readonly sessionId: string;
  /** SDP offer the browser will answer (WebRTC). */
  readonly sdpOffer: string;
  /** The pod that hosts this stream (for affinity). */
  readonly streamerPod: string;
}

export interface MediaRouter {
  /** Open a source + create an SFU track; returns SDP offer. */
  createStreamSession(req: CreateSessionRequest): Promise<CreateSessionResponse>;

  /** Complete the WebRTC negotiation with the browser's SDP answer. */
  completeNegotiation(sessionId: string, sdpAnswer: string): Promise<void>;

  /** Add a viewer to an active SFU track. */
  subscribeViewer(sessionId: string, viewerId: string): Promise<void>;

  /** Remove a viewer; if last viewer, close the source. */
  endStreamSession(sessionId: string): Promise<void>;
}

/**
 * Stub media router — returns synthetic SDP. Used when no real SFU is configured
 * (MEDIA_ROUTER_URL empty). The service boots and serves metadata + signaling
 * tokens; stream negotiation returns a stub offer that the client can inspect.
 */
export class StubMediaRouter implements MediaRouter {
  public async createStreamSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
    const sessionId = crypto.randomUUID();
    return {
      sessionId,
      sdpOffer: this.stubSdp(req),
      streamerPod: 'stub-pod-0',
    };
  }

  public async completeNegotiation(_sessionId: string, _sdpAnswer: string): Promise<void> {
    // No-op in stub mode.
  }

  public async subscribeViewer(_sessionId: string, _viewerId: string): Promise<void> {
    // No-op in stub mode.
  }

  public async endStreamSession(_sessionId: string): Promise<void> {
    // No-op in stub mode.
  }

  private stubSdp(req: CreateSessionRequest): string {
    return [
      'v=0',
      `o=- ${Date.now()} 1 IN IP4 0.0.0.0`,
      's=FleetVision-Stub',
      't=0 0',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=rtpmap:96 H264/90000',
      `a=label:${req.channelId}`,
      'a=mid:0',
      'a=sendonly',
      'a=ice-ufrag:stub',
      'a=ice-pwd:stubstubstubstub',
      'a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
      'a=candidate:1 1 UDP 1 0.0.0.0 9 typ host',
    ].join('\r\n');
  }
}
