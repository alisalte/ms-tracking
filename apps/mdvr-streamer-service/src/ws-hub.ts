/**
 * WsHub — per-IMEI viewer rooms over a binary WebSocket.
 *
 * The socket carries ONLY raw MPEG-TS bytes (consumed directly by JSMpeg's
 * WebSocket source). Status/control is served over REST so it never corrupts
 * the binary stream — the same discipline the standalone pipeline used.
 */
import type { WebSocketServer, WebSocket } from 'ws';

export class WsHub {
  private readonly rooms = new Map<string, Set<WebSocket>>();

  public constructor(wss: WebSocketServer) {
    wss.on('connection', (ws, req) => {
      const imei = this.imeiFromUrl(req.url ?? '');
      if (!imei) {
        ws.close(4000, 'imei required');
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.join(imei, ws);
      ws.on('close', () => this.leave(imei, ws));
      ws.on('error', () => this.leave(imei, ws));
    });
  }

  /** Extract the IMEI room from `?imei=` on the WS request URL. */
  private imeiFromUrl(url: string): string | null {
    const q = url.indexOf('?');
    if (q === -1) return null;
    for (const pair of url.substring(q + 1).split('&')) {
      const [k, v] = pair.split('=');
      if (k === 'imei' && v && /^\d{10,17}$/.test(v)) return v;
    }
    return null;
  }

  public join(imei: string, ws: WebSocket): void {
    let room = this.rooms.get(imei);
    if (!room) {
      room = new Set();
      this.rooms.set(imei, room);
    }
    room.add(ws);
  }

  public leave(imei: string, ws: WebSocket): void {
    const room = this.rooms.get(imei);
    if (!room) return;
    room.delete(ws);
    if (room.size === 0) this.rooms.delete(imei);
  }

  /** Broadcast one MPEG-TS chunk to every viewer of an IMEI. */
  public broadcast(imei: string, chunk: Buffer): void {
    const room = this.rooms.get(imei);
    if (!room) return;
    for (const ws of room) {
      if (ws.readyState === ws.OPEN) ws.send(chunk);
    }
  }

  public viewerCount(imei: string): number {
    return this.rooms.get(imei)?.size ?? 0;
  }

  public totalViewers(): number {
    let n = 0;
    for (const room of this.rooms.values()) n += room.size;
    return n;
  }

  public activeRooms(): string[] {
    return [...this.rooms.keys()];
  }
}
