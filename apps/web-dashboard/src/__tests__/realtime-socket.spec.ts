/**
 * WebSocket lifecycle tests (Sprint E §29): connect, authenticate, subscribe,
 * position update, unsubscribe, reconnect — plus tenant room scoping.
 *
 * socket.io-client is mocked with a minimal local emitter so the socket hook's
 * full state machine (handshake auth token, backoff reconnect, handler
 * re-registration, room join) can be driven without a live gps-engine.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens, saveTokens } from '@/auth/token.storage';
import { useLiveTracking } from '@/hooks/useLiveTracking';
import { useRealtimeSocket } from '@/hooks/useRealtimeSocket';

// ── Fake socket ───────────────────────────────────────────────────────────────

/** Client → server emissions recorded for assertions. */
const clientEmissions: Array<{ event: string; args: unknown[] }> = [];

class FakeSocket {
  url: string;
  opts: Record<string, unknown>;
  handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  disconnectCalls = 0;

  constructor(url: string, opts: Record<string, unknown>) {
    this.url = url;
    this.opts = opts;
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }

  /** Client → server. Recorded; also delivered to local listeners so the
   * test can simulate the server side by emitting from the socket itself. */
  emit(event: string, ...args: unknown[]): void {
    clientEmissions.push({ event, args });
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

const sockets: FakeSocket[] = [];
const ioMock = vi.fn((url: string, opts: Record<string, unknown>) => {
  const s = new FakeSocket(url, opts);
  sockets.push(s);
  return s;
});

vi.mock('socket.io-client', () => ({
  io: (...a: unknown[]) => ioMock(...(a as [string, Record<string, unknown>])),
}));

function latestSocket(): FakeSocket {
  return sockets[sockets.length - 1];
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets.length = 0;
  clientEmissions.length = 0;
  ioMock.mockClear();
  clearTokens();
});

afterEach(() => {
  vi.useRealTimers();
  clearTokens();
});

// ── useRealtimeSocket ─────────────────────────────────────────────────────────

describe('useRealtimeSocket', () => {
  it('connects with the stored JWT in the handshake auth payload', () => {
    saveTokens({ accessToken: 'jwt-token-123', refreshToken: 'r', tenantId: 't1' });

    renderHook(() => useRealtimeSocket({ url: 'http://localhost:3001' }));

    expect(ioMock).toHaveBeenCalledTimes(1);
    const [url, opts] = ioMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001');
    expect(opts).toMatchObject({
      transports: ['websocket'],
      reconnection: false,
      auth: { token: 'jwt-token-123' },
    });
  });

  it('never sends a stale token: the handshake reads token.storage at connect time', () => {
    saveTokens({ accessToken: 'first-token', refreshToken: 'r', tenantId: 't1' });
    const { rerender } = renderHook(
      ({ enabled }) => useRealtimeSocket({ url: 'ws://x', enabled }),
      {
        initialProps: { enabled: true as boolean },
      },
    );
    expect(ioMock.mock.calls[0][1]).toMatchObject({ auth: { token: 'first-token' } });

    // Token rotates (silent refresh) → the NEXT connection carries the new JWT.
    saveTokens({ accessToken: 'second-token', refreshToken: 'r2', tenantId: 't1' });
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(ioMock.mock.calls[1][1]).toMatchObject({ auth: { token: 'second-token' } });
  });

  it('transitions connecting → connected, then disconnected on server drop', () => {
    const { result } = renderHook(() => useRealtimeSocket({ url: 'ws://x' }));
    expect(result.current.state).toBe('connecting');

    act(() => {
      latestSocket().emit('connect');
    });
    expect(result.current.state).toBe('connected');

    act(() => {
      latestSocket().emit('disconnect');
    });
    expect(result.current.state).toBe('disconnected');
  });

  it('reconnects with exponential backoff after a disconnect', async () => {
    renderHook(() =>
      useRealtimeSocket({ url: 'ws://x', baseDelayMs: 1000, maxDelayMs: 30_000, maxRetries: 5 }),
    );
    expect(ioMock).toHaveBeenCalledTimes(1);

    // 1st drop → retry after 1000ms.
    act(() => {
      sockets[0].emit('disconnect');
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(ioMock).toHaveBeenCalledTimes(2);

    // 2nd drop → retry after 2000ms (backoff doubles).
    act(() => {
      sockets[1].emit('disconnect');
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(ioMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(ioMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries attempts', async () => {
    renderHook(() =>
      useRealtimeSocket({ url: 'ws://x', baseDelayMs: 100, maxDelayMs: 100, maxRetries: 2 }),
    );
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        latestSocket().emit('connect_error');
      });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
    }
    // Initial connect + 2 retries max.
    expect(ioMock).toHaveBeenCalledTimes(3);
  });

  it('re-registers event handlers on the reconnected socket (no duplicate subscriptions)', async () => {
    const { result, unmount } = renderHook(() =>
      useRealtimeSocket({ url: 'ws://x', baseDelayMs: 100 }),
    );
    const received: unknown[] = [];
    act(() => {
      result.current.subscribe('position.update', (d) => received.push(d));
    });

    act(() => {
      sockets[0].emit('connect');
      sockets[0].emit('disconnect');
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(ioMock).toHaveBeenCalledTimes(2);

    // Same handler fires exactly once per event on the NEW socket.
    act(() => {
      latestSocket().emit('position.update', { vehicleId: 'v1' });
    });
    expect(received).toEqual([{ vehicleId: 'v1' }]);

    unmount();
    expect(latestSocket().disconnectCalls).toBe(1);
  });

  it('unsubscribe removes the handler from the live socket', () => {
    const { result } = renderHook(() => useRealtimeSocket({ url: 'ws://x' }));
    const received: unknown[] = [];
    let off: () => void = () => {};
    act(() => {
      off = result.current.subscribe('device.status', (d) => received.push(d));
    });
    act(() => {
      latestSocket().emit('device.status', { deviceId: 'd1' });
    });
    expect(received).toHaveLength(1);

    act(() => {
      off();
    });
    act(() => {
      latestSocket().emit('device.status', { deviceId: 'd1' });
    });
    expect(received).toHaveLength(1);
  });
});

// ── useLiveTracking ───────────────────────────────────────────────────────────

describe('useLiveTracking (fleet room subscription)', () => {
  it('does not connect without a tenant context', () => {
    renderHook(() => useLiveTracking(null));
    expect(ioMock).not.toHaveBeenCalled();
  });

  it('authenticates and joins only the authenticated tenant fleet room on connect', () => {
    saveTokens({ accessToken: 'jwt-live', refreshToken: 'r', tenantId: 'tenant-a' });

    renderHook(() => useLiveTracking('tenant-a'));
    expect(ioMock.mock.calls[0][1]).toMatchObject({ auth: { token: 'jwt-live' } });

    act(() => {
      latestSocket().emit('connect');
    });

    const rooms = clientEmissions.filter((e) => e.event === 'subscribe').map((e) => e.args[0]);
    // Only the caller's own tenant room — never another tenant's room; the
    // backend additionally rejects foreign room joins (Sprint B).
    expect(rooms).toEqual(['tenant:tenant-a:fleet']);
  });

  it('applies position.update deltas with latest-position-wins semantics', () => {
    const { result } = renderHook(() => useLiveTracking('tenant-a'));

    act(() => {
      latestSocket().emit('connect');
    });
    act(() => {
      latestSocket().emit('position.update', {
        tenantId: 'tenant-a',
        vehicleId: 'v1',
        latitude: 35.7,
        longitude: 51.3,
        speedKph: 42,
        headingDeg: 90,
        capturedAt: '2026-08-15T07:00:00Z',
        quality: 'VALID',
      });
      latestSocket().emit('position.update', {
        tenantId: 'tenant-a',
        vehicleId: 'v2',
        latitude: 35.8,
        longitude: 51.4,
        speedKph: 10,
        headingDeg: 180,
        capturedAt: '2026-08-15T07:00:01Z',
        quality: 'VALID',
      });
      latestSocket().emit('position.update', {
        tenantId: 'tenant-a',
        vehicleId: 'v1',
        latitude: 35.75,
        longitude: 51.35,
        speedKph: 55,
        headingDeg: 95,
        capturedAt: '2026-08-15T07:00:02Z',
        quality: 'VALID',
      });
    });

    // Map keyed by vehicleId, latest position wins, no history appended.
    expect(result.current.positions.size).toBe(2);
    expect(result.current.positions.get('v1')).toMatchObject({
      latitude: 35.75,
      speedKph: 55,
      capturedAt: '2026-08-15T07:00:02Z',
    });
  });

  it('applies device.status deltas (ONLINE → OFFLINE flips + lastSeenAt)', () => {
    const { result } = renderHook(() => useLiveTracking('tenant-a'));

    act(() => {
      latestSocket().emit('connect');
      latestSocket().emit('device.status', {
        tenantId: 'tenant-a',
        deviceId: 'd1',
        state: 'OFFLINE',
        lastSeenAt: '2026-08-15T07:05:00Z',
      });
    });

    expect(result.current.statuses.get('d1')).toEqual({
      deviceId: 'd1',
      state: 'OFFLINE',
      lastSeenAt: '2026-08-15T07:05:00Z',
    });
  });

  it('re-joins the fleet room after a reconnect (duplicate connections handled)', async () => {
    saveTokens({ accessToken: 'jwt-live', refreshToken: 'r', tenantId: 'tenant-a' });
    renderHook(() => useLiveTracking('tenant-a', 'ws://re'));

    act(() => {
      sockets[0].emit('connect');
    });
    act(() => {
      sockets[0].emit('disconnect');
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      latestSocket().emit('connect');
    });

    const rooms = clientEmissions.filter((e) => e.event === 'subscribe').map((e) => e.args[0]);
    expect(ioMock).toHaveBeenCalledTimes(2);
    // Each connection subscribes exactly once to its own tenant room.
    expect(rooms).toEqual(['tenant:tenant-a:fleet', 'tenant:tenant-a:fleet']);
  });
});
