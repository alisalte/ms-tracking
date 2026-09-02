import { describe, expect, it } from 'vitest';

import { resolveRealtimeTarget } from '@/lib/realtime-url';

describe('resolveRealtimeTarget', () => {
  it('keeps an absolute URL on the default Socket.IO path', () => {
    const t = resolveRealtimeTarget(
      'http://localhost:3001',
      'http://localhost:3001',
      '/gps-ws/socket.io',
    );
    expect(t).toEqual({ url: 'http://localhost:3001', path: '/socket.io' });
  });

  it('maps a path env to same-origin + /socket.io under that prefix', () => {
    const t = resolveRealtimeTarget('/gps-ws', 'http://localhost:3001', '/gps-ws/socket.io');
    expect(t.path).toBe('/gps-ws/socket.io');
    expect(t.url).toMatch(/^https?:\/\//);
  });
});
