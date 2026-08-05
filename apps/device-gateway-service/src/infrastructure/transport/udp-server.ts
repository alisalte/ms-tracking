import { type RemoteInfo, type Socket, createSocket } from 'node:dgram';
/**
 * UDP server — one dgram.Socket per enabled UDP protocol listener (06 §4).
 *
 * UDP is connectionless, so the gateway synthesizes a pseudo-session keyed by
 * `(deviceId, src_ip:port)` once the device authenticates. A single socket serves
 * many devices; inbound datagrams are demultiplexed by source endpoint (06 §4.1).
 *
 * Each datagram may carry one or more frames; we frame via the same PAL adapter
 * as TCP. From here on, UDP and TCP feed the same dispatcher (06 §4.5 — shared
 * decode path). Liveness for UDP pseudo-sessions is a soft TTL (06 §4.4), driven
 * by the HeartbeatPolicy sweeper rather than socket timeouts.
 */
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { DeviceSession, Transport } from '../../domain/index.js';
import type { ProtocolAdapter } from '../protocol/protocol-adapter.js';
import { ByteReader, NEED_MORE } from './byte-reader.js';

/** Per-datagram context handed to the pipeline callback. */
export interface UdpDatagramContext {
  readonly adapter: ProtocolAdapter;
  readonly session: DeviceSession;
  readonly remoteAddress: string;
  readonly remotePort: number;
  /** Send a datagram back to the device's source (06 §4.2 best-effort command path). */
  readonly send: (payload: Buffer) => Promise<void>;
}

export type UdpPacketHandler = (ctx: UdpDatagramContext, packet: Buffer) => Promise<void>;

export interface UdpListenerOptions {
  readonly adapter: ProtocolAdapter;
  readonly port: number;
  readonly host?: string;
  /** Factory that opens/refreshes a UDP pseudo-session for a source. */
  readonly openSession: (init: {
    readonly transport: Transport;
    readonly protocolId: string;
    readonly remoteAddress: string;
    readonly remotePort: number;
  }) => DeviceSession;
  /** Per-frame handler (the dispatcher). */
  readonly onPacket: UdpPacketHandler;
}

export class UdpListener implements OnApplicationShutdown {
  private readonly logger: Logger;
  private socket: Socket | null = null;

  constructor(private readonly options: UdpListenerOptions) {
    this.logger = new Logger(`UdpListener:${options.adapter.id}`);
  }

  public async listen(): Promise<void> {
    const { port, host, adapter } = this.options;
    const socket = createSocket('udp4');
    socket.on('message', (msg: Buffer, rinfo: RemoteInfo) => this.handle(msg, rinfo));
    socket.on('error', (err) => this.logger.warn(`UDP ${adapter.id} socket error: ${err.message}`));

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, host ?? '0.0.0.0', () => {
        socket.off('error', reject);
        resolve();
      });
    });
    this.socket = socket;
    this.logger.log(`Listening on ${host ?? '0.0.0.0'}:${port} [${adapter.meta.name}] (udp).`);
  }

  public async close(): Promise<void> {
    if (!this.socket) return;
    await new Promise<void>((resolve) => {
      this.socket?.close(() => resolve());
      this.socket = null;
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private handle(msg: Buffer, rinfo: RemoteInfo): void {
    const { adapter, openSession, onPacket } = this.options;
    const remoteAddress = rinfo.address;
    const remotePort = rinfo.port;

    // A single datagram may contain >= 1 frame (06 §4.3). Frame them all.
    const reader = new ByteReader();
    reader.append(msg);
    const frames: Buffer[] = [];
    let drained = 0;
    while (drained < 64) {
      const framed = adapter.frame(reader, new Date());
      if (framed === NEED_MORE) break;
      frames.push(Buffer.from(framed.payload));
      drained++;
    }

    if (frames.length === 0) return;

    // One pseudo-session per source for this datagram (06 §4.2). The session
    // manager refreshes TTL on each datagram; here we open/touch per source.
    const session = openSession({
      transport: 'udp',
      protocolId: adapter.id,
      remoteAddress,
      remotePort,
    });

    const ctx: UdpDatagramContext = {
      adapter,
      session,
      remoteAddress,
      remotePort,
      send: async (payload) => {
        if (this.socket) {
          await new Promise<void>((resolve, reject) => {
            this.socket?.send(payload, remotePort, remoteAddress, (err) =>
              err ? reject(err) : resolve(),
            );
          });
        }
      },
    };

    for (const frame of frames) {
      void onPacket(ctx, frame).catch((err) =>
        this.logger.warn(`UDP dispatch error: ${(err as Error).message}`),
      );
    }
  }
}

/**
 * UdpServer — owns a set of UdpListeners, one per enabled UDP protocol.
 */
export class UdpServer implements OnApplicationShutdown {
  private readonly logger = new Logger(UdpServer.name);
  private readonly listeners = new Map<string, UdpListener>();

  public add(id: string, listener: UdpListener): void {
    this.listeners.set(id, listener);
  }

  public async startAll(): Promise<void> {
    const entries = [...this.listeners.entries()];
    const results = await Promise.allSettled(entries.map(([, l]) => l.listen()));
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? entries[i]?.[0] : null))
      .filter((x): x is string => x !== null);
    if (failed.length > 0) {
      this.logger.warn(`Some UDP listeners failed to start: ${failed.join(', ')}.`);
    }
  }

  public async stopAll(): Promise<void> {
    await Promise.allSettled([...this.listeners.values()].map((l) => l.close()));
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.stopAll();
  }
}
