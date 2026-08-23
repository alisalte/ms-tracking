/**
 * VideoServer — the TCP listener the DEVICE dials back on after receiving A9A.
 *
 * One connection carries a stream of binary 0x12 media packets (§3.16),
 * possibly interleaved with junk during TCP re-syncs. The parse loop mirrors
 * the proven standalone pipeline:
 *
 *   buffer += chunk
 *   while buffer:
 *     resync to 0x12 (findPacketStart)
 *     parseMediaPacket -> incomplete? wait for more
 *                       -> invalid? skip one byte
 *                       -> ok? seq-gap check + feed the IMEI's StreamSession
 */
import { createServer, type Server as NetServer } from 'node:net';
import { findPacketStart, parseMediaPacket } from '@fleetvision/meitrack-media-protocol';
import type { StreamerConfig } from './config.js';
import type { StreamRegistry } from './stream-session.js';

export interface VideoServerHandle {
  readonly server: NetServer;
  /** Active device media connections. */
  connections(): number;
}

export function startVideoServer(
  config: StreamerConfig,
  registry: StreamRegistry,
  log: (tag: string, msg: string) => void,
): VideoServerHandle {
  let activeConnections = 0;

  const server = createServer((socket) => {
    const addr = `${socket.remoteAddress ?? '?'}:${socket.remotePort ?? '?'}`;
    log('VIDEO', `stream connection from ${addr}`);
    activeConnections++;
    socket.setNoDelay(true);

    let buffer = Buffer.alloc(0);
    let lastSeq = -1;
    let imei: string | null = null;

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length > 0) {
        if (buffer[0] !== 0x12) {
          const idx = findPacketStart(buffer);
          if (idx === -1) {
            buffer = Buffer.alloc(0);
            break;
          }
          if (idx > 0) log('VIDEO', `resync skipped ${idx} bytes`);
          buffer = buffer.subarray(idx);
        }

        const res = parseMediaPacket(buffer);
        if (res.status === 'invalid') {
          buffer = buffer.subarray(1);
          continue;
        }
        if (res.status === 'incomplete') break;

        const pkt = res.packet;

        // Bind the connection to the first IMEI seen (media sockets are per device).
        if (imei === null) {
          imei = pkt.imei;
          const opened = registry.open(imei);
          if ('error' in opened) {
            log('VIDEO', `refusing stream for ${imei}: ${opened.error}`);
            socket.destroy();
            return;
          }
          log('VIDEO', `media stream bound to IMEI ${imei}`);
        }

        // Sequence gap detection (packetNo wraps at 0xffff).
        if (lastSeq >= 0) {
          const expect = (lastSeq + 1) & 0xffff;
          const lost = (pkt.packetNo - expect) & 0xffff;
          if (lost > 0 && lost < 1000) {
            log('VIDEO', `seq gap: expected ${expect}, got ${pkt.packetNo} (~${lost} lost)`);
          }
        }
        lastSeq = pkt.packetNo;

        const session = registry.get(pkt.imei);
        session?.feed(pkt);
        buffer = buffer.subarray(pkt.totalLength);
      }
    });

    socket.on('close', () => {
      activeConnections--;
      log('VIDEO', `stream connection closed (${imei ?? 'unbound'})`);
      if (imei) registry.close(imei);
    });
    socket.on("error", (e: Error) => {
      log('VIDEO', `error: ${e.message}`);
    });
  });

  server.listen(config.VIDEO_PORT, config.VIDEO_HOST, () => {
    log('SRV', `video server on :${config.VIDEO_PORT} (device media dialback)`);
  });

  return {
    server,
    connections: () => activeConnections,
  };
}
