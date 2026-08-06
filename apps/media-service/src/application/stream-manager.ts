/**
 * Stream manager — the stream-session orchestrator (09 §5, §2.3).
 *
 * Manages the lifecycle of StreamSessions: open (authorize → open source on the
 * media-router → create session → mint signaling token), addViewer (lazy
 * activation — opens source only on first viewer), removeViewer (close when last
 * viewer leaves + idle timeout), and close.
 *
 * Lazy activation (09 §2.3): a channel with no viewers/recording/AI spends zero
 * bandwidth. The source is pulled only when the first consumer subscribes.
 */
import { Logger } from '@nestjs/common';
import type { MediaConfig } from '../config/media.config.js';
import { decideCodec } from '../domain/codec-strategy.js';
import { mintSignalingToken, type SignalingToken } from '../domain/signaling-token.js';
import type { VideoChannel } from '../domain/video-channel.js';
import type { MediaRouter } from '../infrastructure/media-router-port.js';
import type { RedisSessionCache } from '../infrastructure/cache/redis-session-cache.js';
import type { SessionRepository } from '../infrastructure/persistence/session.repository.js';

export interface StreamManagerDeps {
  readonly config: MediaConfig;
  readonly router: MediaRouter;
  readonly sessionCache: RedisSessionCache;
  readonly sessionRepo: SessionRepository;
}

export interface OpenStreamResult {
  readonly sessionId: string;
  readonly signalingToken: SignalingToken;
  readonly sdpOffer: string;
  readonly codecDecision: ReturnType<typeof decideCodec>;
  readonly wsUrl: string;
}

/** In-memory active session registry (viewer count + source state). */
interface ActiveSession {
  readonly sessionId: string;
  readonly channelId: string;
  readonly tenantId: string;
  viewerCount: number;
  sourceActive: boolean;
}

export class StreamManager {
  private readonly logger = new Logger('StreamManager');
  /** Active sessions keyed by sessionId. */
  private readonly sessions = new Map<string, ActiveSession>();
  /** Active sessions per channel (for lazy activation). */
  private readonly channelSessions = new Map<string, Set<string>>();

  constructor(private readonly deps: StreamManagerDeps) {}

  /**
   * Open a stream session for a channel. Creates the session + mints a signaling
   * token but does NOT pull the source yet (lazy activation — the source is
   * opened when the first viewer subscribes via addViewer).
   */
  public async openSession(channel: VideoChannel, opts: {
    userId?: string | null;
    quality?: string;
    mode?: string;
  }): Promise<OpenStreamResult> {
    const mode = (opts.mode ?? 'LIVE') as Parameters<typeof decideCodec>[1];
    const quality = (opts.quality ?? 'auto') as 'auto' | 'high' | 'medium' | 'low' | 'audio-only';

    // Codec decision: passthrough or transcode?
    const codecDecision = decideCodec(channel.codec, mode);

    // Create the session on the media-router.
    const routerResp = await this.deps.router.createStreamSession({
      channelId: channel.channelId,
      tenantId: channel.tenantId,
      mode,
      quality,
      ttlSeconds: this.deps.config.MEDIA_IDLE_CLOSE_SECONDS,
    });

    // Persist the session record.
    await this.deps.sessionRepo.create({
      sessionId: routerResp.sessionId,
      tenantId: channel.tenantId,
      channelId: channel.channelId,
      userId: opts.userId ?? null,
      mode,
      quality,
      streamerPod: routerResp.streamerPod,
    });

    // Mint the signaling token.
    const signalingToken = mintSignalingToken({
      sessionId: routerResp.sessionId,
      channelId: channel.channelId,
      tenantId: channel.tenantId,
      userId: opts.userId ?? null,
      quality,
      ttlMs: this.deps.config.MEDIA_SIGNALING_TOKEN_TTL_SECONDS * 1000,
    });
    await this.deps.sessionCache.setToken(signalingToken.payload);

    // Record channel→pod affinity for co-location.
    await this.deps.sessionCache.setPodAffinity(channel.channelId, routerResp.streamerPod);

    // Track the session in-memory.
    const active: ActiveSession = {
      sessionId: routerResp.sessionId,
      channelId: channel.channelId,
      tenantId: channel.tenantId,
      viewerCount: 0,
      sourceActive: false, // lazy — not active until first viewer
    };
    this.sessions.set(routerResp.sessionId, active);
    this.channelSessionSet(channel.channelId).add(routerResp.sessionId);

    this.logger.log(
      `Opened session ${routerResp.sessionId} for channel ${channel.channelId} ` +
        `(${channel.codec} → ${codecDecision.action}/${codecDecision.outputCodec}).`,
    );

    return {
      sessionId: routerResp.sessionId,
      signalingToken,
      sdpOffer: routerResp.sdpOffer,
      codecDecision,
      wsUrl: `ws://localhost:${this.deps.config.MEDIA_WS_PORT}/ws/media`,
    };
  }

  /**
   * Add a viewer to an active session. Lazy activation: if this is the first
   * viewer, the source is pulled.
   */
  public async addViewer(sessionId: string, viewerId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found or closed.`);
    session.viewerCount++;
    if (!session.sourceActive) {
      session.sourceActive = true;
      this.logger.log(`Activating source for session ${sessionId} (first viewer).`);
    }
    await this.deps.router.subscribeViewer(sessionId, viewerId);
    await this.deps.sessionRepo.updateViewerCount(sessionId, session.viewerCount, 'ACTIVE');
  }

  /** Remove a viewer; if last viewer, schedule idle close. */
  public async removeViewer(sessionId: string, _viewerId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.viewerCount = Math.max(0, session.viewerCount - 1);
    if (session.viewerCount === 0) {
      // Last viewer gone → close the session (Sprint 10: immediate close;
      // the full 5-min idle timer is a later refinement).
      await this.closeSession(sessionId);
    } else {
      await this.deps.sessionRepo.updateViewerCount(sessionId, session.viewerCount, 'ACTIVE');
    }
  }

  /** Close a session: tear down the source, persist the close, clean up. */
  public async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await this.deps.router.endStreamSession(sessionId);
    await this.deps.sessionRepo.close(sessionId);
    await this.deps.sessionCache.deleteToken(sessionId);
    this.sessions.delete(sessionId);
    const set = this.channelSessions.get(session.channelId);
    if (set) {
      set.delete(sessionId);
      if (set.size === 0) this.channelSessions.delete(session.channelId);
    }
    this.logger.log(`Closed session ${sessionId}.`);
  }

  private channelSessionSet(channelId: string): Set<string> {
    let set = this.channelSessions.get(channelId);
    if (!set) {
      set = new Set();
      this.channelSessions.set(channelId, set);
    }
    return set;
  }
}
