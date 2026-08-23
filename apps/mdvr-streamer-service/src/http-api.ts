/**
 * HTTP + WebSocket server — browser-facing plane.
 *
 *   GET /health/live   — liveness (no auth; used by compose healthcheck).
 *   GET /status        — aggregate stream stats (streams, viewers, connections).
 *   GET /status/:imei  — one stream's stats.
 *   WS  /?imei=<imei>  — binary MPEG-TS fan-out for JSMpeg players.
 *
 * The WebSocket carries raw TS bytes only (JSMpeg's WebSocket source expects
 * an exclusively binary stream); all control/status rides on REST.
 *
 * v1 auth posture: this service sits on the internal Docker network behind
 * nginx; the REST/WS endpoints are intentionally unauthenticated (single-
 * tenant deployment). See docs/implementation/MDVR_LIVE_VIDEO.md before
 * exposing :3013/:6182 beyond a trusted network.
 */
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { StreamerConfig } from './config.js';
import type { StreamRegistry } from './stream-session.js';
import type { VideoServerHandle } from './video-server.js';
import { WsHub } from './ws-hub.js';

export interface HttpApiHandle {
  readonly server: Server;
  readonly hub: WsHub;
}

export function startHttpApi(
  config: StreamerConfig,
  registry: StreamRegistry,
  video: VideoServerHandle,
  startedAt: number,
  log: (tag: string, msg: string) => void,
): HttpApiHandle {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';

    if (url === '/health/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          videoConnections: video.connections(),
          totalViewers: registry.snapshot().reduce((n, s) => n + s.viewers, 0),
          streams: registry.snapshot(),
        }),
      );
      return;
    }

    const statusMatch = /^\/status\/(\d{10,17})$/.exec(url);
    if (statusMatch) {
      const imei = statusMatch[1] ?? '';
      const s = registry.get(imei)?.stats();
      if (!s) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no active stream for imei' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(s));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const wss = new WebSocketServer({ server });
  const hub = new WsHub(wss);
  wss.on('connection', () => {
    log(
      'WS',
      `player connected (${hub.totalViewers()} viewers across ${hub.activeRooms().length} rooms)`,
    );
  });

  server.listen(config.PORT, config.HOST, () => {
    log('SRV', `http/ws server on :${config.PORT}`);
  });

  return { server, hub };
}
