import type { Redis } from '@fleetvision/cache-redis';
/**
 * WebSocket signaling gateway — Socket.IO server for WebRTC negotiation
 * (09 §3.7; 10 §4).
 *
 * Carries offer/answer/ICE exchange and control commands ONLY — never video.
 * The actual RTP flow travels over WebRTC (UDP/SRTP). Per-stream signaling
 * tokens are verified on connect. Multi-pod fan-out via the Redis adapter.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server as IoServer } from 'socket.io';
import type { MediaConfig } from '../../config/media.config.js';
import type { RedisSessionCache } from '../cache/redis-session-cache.js';

export interface SignalingGatewayDeps {
  readonly config: MediaConfig;
  readonly redis: Redis;
  readonly sessionCache: RedisSessionCache;
}

export class SignalingGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('SignalingGateway');
  private io: IoServer | null = null;

  constructor(private readonly deps: SignalingGatewayDeps) {}

  public async onApplicationBootstrap(): Promise<void> {
    if (!this.deps.config.MEDIA_WS_ENABLED) {
      this.logger.log('WebSocket signaling disabled (MEDIA_WS_ENABLED=false).');
      return;
    }
    try {
      await this.start();
    } catch (err) {
      this.logger.error(
        `Failed to start WS signaling server — continuing without signaling: ${(err as Error).message}`,
      );
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    this.io?.close();
    this.io = null;
  }

  private async start(): Promise<void> {
    const io = new IoServer(this.deps.config.MEDIA_WS_PORT, {
      cors: { origin: '*' },
      maxHttpBufferSize: 1e6,
      pingTimeout: 30_000,
    });

    const pubClient = this.deps.redis;
    const subClient = this.deps.redis.duplicate();
    io.adapter(createAdapter(pubClient, subClient));

    io.use(async (socket, next) => {
      // Verify the signaling token on connect.
      const token = socket.handshake.auth?.token as string | undefined;
      const sessionId = socket.handshake.auth?.sessionId as string | undefined;
      if (!token || !sessionId) {
        next(new Error('Missing signaling token or sessionId.'));
        return;
      }
      const payload = await this.deps.sessionCache.getToken(sessionId);
      if (!payload) {
        next(new Error('Invalid or expired signaling token.'));
        return;
      }
      // Attach the verified payload for downstream handlers.
      socket.data.payload = payload;
      next();
    });

    io.on('connection', (socket) => {
      const payload = socket.data.payload as { sessionId: string; channelId: string } | undefined;
      this.logger.debug(`WS client connected: ${socket.id} session=${payload?.sessionId}`);
      if (payload?.sessionId) socket.join(`session:${payload.sessionId}`);

      socket.on('stream.answer', (_sdp: string) => {
        // Relay the browser's SDP answer to the media-router.
        // In stub mode this is a no-op; the real router calls completeNegotiation.
        this.logger.debug(`SDP answer received from ${socket.id}`);
      });

      socket.on('ice.candidate', (_candidate: unknown) => {
        // Trickle ICE — relay to the media-router (stub: no-op).
        this.logger.debug(`ICE candidate from ${socket.id}`);
      });

      socket.on('stream.unsubscribe', () => {
        socket.disconnect(true);
      });

      socket.on('snapshot.request', () => {
        // Stub: would trigger a JPEG capture from the current frame.
        socket.emit('stream.event', { type: 'snapshot', status: 'not_available' });
      });

      socket.on('disconnect', () => {
        this.logger.debug(`WS client disconnected: ${socket.id}`);
      });
    });

    this.io = io;
    this.logger.log(`Signaling WS server listening on :${this.deps.config.MEDIA_WS_PORT}`);
  }

  /** Emit an SDP offer to a session room (the browser answers). */
  public emitOffer(sessionId: string, sdp: string): void {
    this.io?.to(`session:${sessionId}`).emit('stream.offer', sdp);
  }

  /** Emit a state change to a session room. */
  public emitState(sessionId: string, state: string): void {
    this.io?.to(`session:${sessionId}`).emit('stream.state', { state });
  }
}
