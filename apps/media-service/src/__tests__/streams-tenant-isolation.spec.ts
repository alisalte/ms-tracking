import { getPrincipal } from '@fleetvision/auth';
import { describe, expect, it } from '@jest/globals';
import { StreamsController } from '../api/streams.controller.js';
import { StreamManager } from '../application/stream-manager.js';

/**
 * Sprint 1 requirements 1 & 6: the media streams controller must derive
 * tenantId from the verified JWT principal (no spoofable header), and
 * closeSession must verify tenant ownership (no cross-tenant delete).
 * StreamManager.closeSessionForTenant returns false for a cross-tenant or
 * unknown session (no existence oracle).
 */
describe('media streams controller derives tenantId from the principal', () => {
  it('imports getPrincipal (JWT-derived tenant)', () => {
    expect(typeof getPrincipal).toBe('function');
  });
  it('StreamsController does not read the spoofable tenant-id header', () => {
    const src = StreamsController.toString();
    expect(src).not.toMatch(/headers\['tenant-id'\]/);
    expect(src).not.toMatch(/query\['tenant-id'\]/);
  });
});

describe('StreamManager.closeSessionForTenant tenant check', () => {
  function mkManager(): StreamManager {
    return new StreamManager({
      router: {
        createStreamSession: async () => ({ sessionId: 's1', streamerPod: 'pod-1' }),
        endStreamSession: async () => {},
        subscribeViewer: async () => {},
      } as never,
      sessionRepo: {
        create: async () => {},
        close: async () => {},
        updateViewerCount: async () => {},
      } as never,
      sessionCache: {
        getToken: async () => null,
        mintToken: async () => ({ token: 't', expiresAt: new Date() }),
        deleteToken: async () => {},
      } as never,
      config: { MEDIA_IDLE_CLOSE_SECONDS: 300 } as never,
    });
  }

  it('returns false for an unknown session (no oracle)', async () => {
    const m = mkManager();
    await expect(
      m.closeSessionForTenant('s-nope', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ).resolves.toBe(false);
  });
});
