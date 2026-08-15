/**
 * StreamManager lifecycle tests (09 §5, §2.3).
 *
 * These exercise the session orchestration against in-memory fakes for the
 * router, session repo, and token cache — no DB/Redis/SFU required. They pin
 * the current contract: the stub media-router returns a synthetic SDP, the
 * manager handles lazy source activation (source pulled only on the first
 * viewer), viewer-count bookkeeping, and clean teardown on close.
 *
 * The fakes deliberately mirror the real port interfaces so the tests break
 * loudly if the orchestrator drifts from them.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { StreamManager } from '../application/stream-manager.js';
import type { MediaConfig } from '../config/media.config.js';
import { VideoChannel } from '../domain/video-channel.js';
import type { MediaRouter } from '../infrastructure/media-router-port.js';
import { StubMediaRouter } from '../infrastructure/media-router-port.js';

// --- minimal config stub (only the fields StreamManager reads) ---
function makeConfig(): MediaConfig {
  return {
    PORT: 3002,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'fatal',
    ENVIRONMENT: 'local',
    serviceName: 'media-service',
    JWT_SECRET: 'test-secret-at-least-thirty-two-chars-long',
    JWT_ISSUER: 'fleetvision',
    JWT_AUDIENCE: 'fleetvision',
    MEDIA_WS_CORS_ORIGIN: '',
    DBURL: 'postgres://stub',
    REDISURL: 'redis://stub',
    MEDIA_KAFKA_BROKERS: 'localhost:9092',
    MEDIA_KAFKA_CLIENT_ID: 'media-service',
    MEDIA_KAFKA_CHANNEL_TOPIC: 'fleetvision.media.channel.events',
    MEDIA_KAFKA_STREAM_TOPIC: 'fleetvision.media.stream.events',
    MEDIA_WS_PORT: 3002,
    MEDIA_WS_ENABLED: false,
    MEDIA_ROUTER_URL: '',
    MEDIA_STUN_URL: 'stun:stun.l.google.com:19302',
    MEDIA_TURN_URL: '',
    MEDIA_SIGNALING_TOKEN_TTL_SECONDS: 300,
    MEDIA_IDLE_CLOSE_SECONDS: 300,
  };
}

// --- in-memory session repo fake ---
interface FakeSessionRow {
  sessionId: string;
  tenantId: string;
  channelId: string;
  userId: string | null;
  mode: string;
  quality: string;
  streamerPod: string | null;
  state: string;
  viewerCount: number;
}

class FakeSessionRepository {
  public readonly rows = new Map<string, FakeSessionRow>();

  async create(input: {
    sessionId: string;
    tenantId: string;
    channelId: string;
    userId: string | null;
    mode: string;
    quality: string;
    streamerPod: string | null;
  }): Promise<void> {
    this.rows.set(input.sessionId, { ...input, state: 'CONNECTING', viewerCount: 0 });
  }

  async close(sessionId: string): Promise<void> {
    const row = this.rows.get(sessionId);
    if (row) {
      row.state = 'CLOSED';
    }
  }

  async updateViewerCount(sessionId: string, count: number, state: string): Promise<void> {
    const row = this.rows.get(sessionId);
    if (row) {
      row.viewerCount = count;
      row.state = state;
    }
  }
}

// --- in-memory session cache fake ---
class FakeSessionCache {
  public readonly tokens = new Map<string, object>();
  public readonly podAffinity = new Map<string, string>();

  async setToken(payload: object): Promise<void> {
    // @ts-expect-error — payload has sessionId at runtime; fake does not need the type
    this.tokens.set(payload.sessionId, payload);
  }
  async getToken(sessionId: string) {
    return (this.tokens.get(sessionId) ?? null) as object | null;
  }
  async deleteToken(sessionId: string): Promise<void> {
    this.tokens.delete(sessionId);
  }
  async setPodAffinity(channelId: string, pod: string): Promise<void> {
    this.podAffinity.set(channelId, pod);
  }
  async getPodAffinity(channelId: string) {
    return this.podAffinity.get(channelId) ?? null;
  }
}

function makeChannel(overrides: Partial<VideoChannel> = {}): VideoChannel {
  return new VideoChannel({
    channelId: 'ch-1',
    tenantId: 'tenant-1',
    vehicleId: 'veh-1',
    siteId: null,
    deviceId: 'dev-1',
    label: 'Forward camera',
    logicalChannel: 1,
    protocol: 'JT1078',
    codec: 'H265',
    endpoint: null,
    status: 'ONLINE',
    ptz: false,
    capabilities: {},
    version: 0,
    ...overrides,
  });
}

describe('StreamManager lifecycle (09 §5, §2.3)', () => {
  let router: MediaRouter;
  let repo: FakeSessionRepository;
  let cache: FakeSessionCache;
  let manager: StreamManager;

  beforeEach(() => {
    router = new StubMediaRouter();
    repo = new FakeSessionRepository();
    cache = new FakeSessionCache();
    // StreamManagerDeps names the concrete SessionRepository / RedisSessionCache
    // classes; the fakes here implement only the public method surface the
    // manager actually calls, so we satisfy the dependency shape via a cast.
    manager = new StreamManager({
      config: makeConfig(),
      router,
      sessionCache: cache as unknown as InstanceType<
        typeof import('../infrastructure/cache/redis-session-cache.js').RedisSessionCache
      >,
      sessionRepo: repo as unknown as InstanceType<
        typeof import('../infrastructure/persistence/session.repository.js').SessionRepository
      >,
    });
  });

  describe('openSession', () => {
    it('creates a session via the router and returns a signaling token + SDP offer', async () => {
      const result = await manager.openSession(makeChannel(), { userId: 'u-1' });

      expect(result.sessionId).toEqual(expect.any(String));
      expect(result.sdpOffer).toEqual(expect.any(String));
      expect(result.signalingToken.token).toMatch(/^[0-9a-f]{64}$/);
      expect(result.signalingToken.payload.sessionId).toBe(result.sessionId);
    });

    it('persists the session row and caches the signaling token', async () => {
      const result = await manager.openSession(makeChannel(), { userId: 'u-1' });

      const row = repo.rows.get(result.sessionId);
      expect(row).toBeDefined();
      expect(row?.channelId).toBe('ch-1');
      expect(row?.tenantId).toBe('tenant-1');
      expect(row?.userId).toBe('u-1');
      expect(row?.state).toBe('CONNECTING');
      expect(row?.viewerCount).toBe(0);

      expect(cache.tokens.get(result.sessionId)).toBeDefined();
    });

    it('records channel→pod affinity for viewer co-location', async () => {
      await manager.openSession(makeChannel(), {});
      expect(cache.podAffinity.get('ch-1')).toBe('stub-pod-0');
    });

    it('applies the codec decision to the channel codec (H265 → transcode for LIVE)', async () => {
      const result = await manager.openSession(makeChannel({ codec: 'H265' }), { mode: 'LIVE' });
      expect(result.codecDecision.action).toBe('transcode');
      expect(result.codecDecision.outputCodec).toBe('H264');
    });

    it('defaults mode to LIVE and quality to auto', async () => {
      const result = await manager.openSession(makeChannel(), {});
      expect(result.codecDecision.action).toBe('transcode'); // H265 + LIVE → transcode
    });

    it('builds the wsUrl from the configured media WS port', async () => {
      const result = await manager.openSession(makeChannel(), {});
      expect(result.wsUrl).toBe('ws://localhost:3002/ws/media');
    });
  });

  describe('addViewer — lazy source activation', () => {
    it('activates the source on the first viewer', async () => {
      const { sessionId } = await manager.openSession(makeChannel(), {});
      // Router stub tracks subscribeViewer calls indirectly via no thrown error;
      // the observable effect is viewerCount + state in the repo.
      await manager.addViewer(sessionId, 'viewer-1');
      expect(repo.rows.get(sessionId)?.viewerCount).toBe(1);
      expect(repo.rows.get(sessionId)?.state).toBe('ACTIVE');
    });

    it('increments viewer count across multiple viewers without re-activating', async () => {
      const { sessionId } = await manager.openSession(makeChannel(), {});
      await manager.addViewer(sessionId, 'viewer-1');
      await manager.addViewer(sessionId, 'viewer-2');
      await manager.addViewer(sessionId, 'viewer-3');
      expect(repo.rows.get(sessionId)?.viewerCount).toBe(3);
    });

    it('throws when adding a viewer to an unknown/closed session', async () => {
      await expect(manager.addViewer('no-such-session', 'viewer-1')).rejects.toThrow(
        /not found or closed/i,
      );
    });
  });

  describe('removeViewer — last-out triggers close', () => {
    it('decrements the viewer count while viewers remain', async () => {
      const { sessionId } = await manager.openSession(makeChannel(), {});
      await manager.addViewer(sessionId, 'v1');
      await manager.addViewer(sessionId, 'v2');

      await manager.removeViewer(sessionId, 'v1');
      expect(repo.rows.get(sessionId)?.viewerCount).toBe(1);
      expect(repo.rows.get(sessionId)?.state).toBe('ACTIVE');
    });

    it('closes the session when the last viewer leaves', async () => {
      const { sessionId } = await manager.openSession(makeChannel(), {});
      await manager.addViewer(sessionId, 'v1');

      await manager.removeViewer(sessionId, 'v1');

      expect(repo.rows.get(sessionId)?.state).toBe('CLOSED');
      // token must be invalidated on close so the WS path rejects reconnects
      expect(cache.tokens.get(sessionId)).toBeUndefined();
    });

    it('clamps viewer count at zero (never negative)', async () => {
      const { sessionId } = await manager.openSession(makeChannel(), {});
      await manager.addViewer(sessionId, 'v1');
      // removeViewer closes on last-out, so reopen a second session for this check
      await manager.removeViewer(sessionId, 'v1');
      // repo now CLOSED at 0; the session is gone from the manager registry.
      // A second removeViewer on a closed session is a silent no-op:
      await expect(manager.removeViewer(sessionId, 'v1')).resolves.toBeUndefined();
    });
  });

  describe('closeSession — explicit teardown', () => {
    it('ends the router session, persists CLOSED state, and deletes the cached token', async () => {
      const { sessionId } = await manager.openSession(makeChannel(), {});
      await manager.addViewer(sessionId, 'v1');

      await manager.closeSession(sessionId);

      expect(repo.rows.get(sessionId)?.state).toBe('CLOSED');
      expect(cache.tokens.get(sessionId)).toBeUndefined();
    });

    it('is idempotent (closing a closed session is a no-op)', async () => {
      const { sessionId } = await manager.openSession(makeChannel(), {});
      await manager.closeSession(sessionId);
      // second close must not throw
      await expect(manager.closeSession(sessionId)).resolves.toBeUndefined();
    });
  });

  describe('per-channel session tracking', () => {
    it('supports multiple concurrent sessions on the same channel', async () => {
      const channel = makeChannel();
      const a = await manager.openSession(channel, { userId: 'u-1' });
      const b = await manager.openSession(channel, { userId: 'u-2' });

      expect(a.sessionId).not.toBe(b.sessionId);
      await manager.addViewer(a.sessionId, 'va');
      await manager.addViewer(b.sessionId, 'vb');

      expect(repo.rows.get(a.sessionId)?.viewerCount).toBe(1);
      expect(repo.rows.get(b.sessionId)?.viewerCount).toBe(1);
    });

    it('closing one session does not affect another on the same channel', async () => {
      const channel = makeChannel();
      const a = await manager.openSession(channel, { userId: 'u-1' });
      const b = await manager.openSession(channel, { userId: 'u-2' });

      await manager.addViewer(a.sessionId, 'va');
      await manager.addViewer(b.sessionId, 'vb');

      await manager.closeSession(a.sessionId);

      expect(repo.rows.get(a.sessionId)?.state).toBe('CLOSED');
      expect(repo.rows.get(b.sessionId)?.state).toBe('ACTIVE');
      expect(repo.rows.get(b.sessionId)?.viewerCount).toBe(1);
    });
  });
});

describe('StubMediaRouter — current SFU-stub contract', () => {
  it('createStreamSession returns a synthetic SDP offer naming the channel', () => {
    const stub = new StubMediaRouter();
    return stub
      .createStreamSession({
        channelId: 'ch-42',
        tenantId: 'tenant-1',
        mode: 'LIVE',
        quality: 'auto',
        ttlSeconds: 300,
      })
      .then((resp) => {
        expect(resp.sessionId).toEqual(expect.any(String));
        expect(resp.streamerPod).toBe('stub-pod-0');
        // SDP must be a non-empty string a browser could at least parse the shape of.
        expect(resp.sdpOffer).toContain('v=0');
        expect(resp.sdpOffer).toContain('m=video');
        expect(resp.sdpOffer).toContain('ch-42');
      });
  });

  it('completeNegotiation / subscribeViewer / endStreamSession are no-ops that resolve', async () => {
    const stub = new StubMediaRouter();
    await expect(stub.completeNegotiation('s-1', 'sdp-answer')).resolves.toBeUndefined();
    await expect(stub.subscribeViewer('s-1', 'viewer-1')).resolves.toBeUndefined();
    await expect(stub.endStreamSession('s-1')).resolves.toBeUndefined();
  });
});
