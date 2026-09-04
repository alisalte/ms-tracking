import { type Server, type Socket, createServer } from 'node:net';
/**
 * TCP server — one net.Server per enabled protocol listener (06 §3).
 *
 * The accept loop spawns a connection handler per accepted socket. Each handler
 * runs a read → frame → dispatch loop over a per-connection ByteReader (06 §3.2).
 * The decode/pipeline stages run off the read loop (decoupled by the bounded
 * dispatcher queue — 06 §8.2), so one slow Kafka produce never stalls reads.
 *
 * Buffering & deadlines (06 §3.3):
 *   - setNoDelay(true) — Nagle off (request/response; latency > throughput).
 *   - socket.setTimeout — reset on every framed read (drives idle timeout).
 *   - TCP keepalive off (the gateway uses app-level heartbeat).
 *
 * This module owns transport I/O only; it is fully protocol-agnostic — the
 * adapter (resolved via the PAL) does framing/decode.
 */
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { DeviceSession, Transport } from '../../domain/index.js';
import type { ProtocolAdapter } from '../protocol/protocol-adapter.js';
import { ByteReader, NEED_MORE } from './byte-reader.js';

/** Per-connection context handed to the pipeline callback. */
export interface TcpConnectionContext {
  readonly socket: Socket;
  readonly session: DeviceSession;
  readonly adapter: ProtocolAdapter;
  readonly remoteAddress: string;
  readonly remotePort: number;
}

/**
 * Callback the application wires: receives framed raw packets off the socket and
 * runs them through the dispatcher. Returning false signals back-pressure (the
 * read loop pauses); the connection remains open.
 */
export type TcpPacketHandler = (ctx: TcpConnectionContext, packet: Buffer) => Promise<boolean>;

export interface TcpListenerOptions {
  readonly adapter: ProtocolAdapter;
  readonly port: number;
  readonly host?: string;
  /** Idle timeout (ms) — socket.setTimeout, reset on each framed read (06 §3.3). */
  readonly idleTimeoutMs: number;
  /**
   * Factory that opens a DeviceSession for a newly accepted socket. Returning
   * null REJECTS the connection (pool full / back-pressure) — the socket is
   * destroyed so the load balancer retries another pod (Sprint D §7).
   */
  readonly openSession: (init: {
    readonly transport: Transport;
    readonly protocolId: string;
    readonly remoteAddress: string;
    readonly remotePort: number;
  }) => DeviceSession | null;
  /** Per-frame handler (the dispatcher). */
  readonly onPacket: TcpPacketHandler;
  /** Called once after a session is opened (register transport terminator, §7). */
  readonly onOpen?: (ctx: TcpConnectionContext) => void;
  /** Called once when the socket closes (graceful teardown hook). */
  readonly onClose?: (ctx: TcpConnectionContext, reason: string) => void;
  /** Called on an inbound-error before the socket closes. */
  readonly onError?: (ctx: TcpConnectionContext, err: Error) => void;
  /** Called on idle-timeout fire (06 §12.4). */
  readonly onIdleTimeout?: (ctx: TcpConnectionContext) => void;
}

/**
 * A single per-protocol TCP listener. Owns one net.Server.
 */
export class TcpListener implements OnApplicationShutdown {
  private readonly logger: Logger;
  private server: Server | null = null;

  constructor(private readonly options: TcpListenerOptions) {
    this.logger = new Logger(`TcpListener:${options.adapter.id}`);
  }

  /** Bind and begin accepting. Resolves when listening. */
  public async listen(): Promise<void> {
    const { port, host, adapter } = this.options;
    const server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host ?? '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.logger.log(`Listening on ${host ?? '0.0.0.0'}:${port} [${adapter.meta.name}].`);
  }

  /** Stop accepting and close all connections. */
  public async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
      this.server = null;
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private handle(socket: Socket): void {
    const remoteAddress = socket.remoteAddress ?? 'unknown';
    const remotePort = socket.remotePort ?? 0;
    const { adapter, openSession, onClose, onOpen, onError, onIdleTimeout, idleTimeoutMs } =
      this.options;

    socket.setNoDelay(true);
    socket.setTimeout(idleTimeoutMs);

    const session = openSession({
      transport: 'tcp',
      protocolId: adapter.id,
      remoteAddress,
      remotePort,
    });
    // Sprint D §7 — pool full: reject by destroying the socket (LB retries).
    if (!session) {
      socket.destroy();
      return;
    }
    const reader = new ByteReader();
    const ctx: TcpConnectionContext = { socket, session, adapter, remoteAddress, remotePort };
    let closed = false;

    // Register the transport terminator so manager-initiated closes (duplicate
    // session, sweep, shutdown) also destroy this socket (Sprint D §7/§36).
    onOpen?.(ctx);
    this.logger.log(
      `TCP accept ${remoteAddress}:${remotePort} session=${session.id} [${adapter.id}]`,
    );

    const cleanup = (reason: string) => {
      if (closed) return;
      closed = true;
      onClose?.(ctx, reason);
      socket.destroy();
    };

    let loggedFirstBytes = false;
    socket.on('data', (chunk: Buffer) => {
      if (!loggedFirstBytes) {
        loggedFirstBytes = true;
        const preview = chunk.subarray(0, 80);
        this.logger.log(
          `First ${chunk.length}B from ${remoteAddress}:${remotePort} session=${session.id}: ` +
            `hex=${preview.toString('hex')} ascii=${JSON.stringify(preview.toString('latin1'))}`,
        );
      }
      reader.append(chunk);
      // Drain all complete frames in the buffer before yielding to the event loop.
      this.drainFrames(reader, ctx).catch((err) => onError?.(ctx, err as Error));
    });

    socket.on('timeout', () => {
      onIdleTimeout?.(ctx);
      cleanup('IDLE_TIMEOUT');
    });

    socket.on('error', (err) => {
      onError?.(ctx, err);
      cleanup('SOCKET_ERROR');
    });

    socket.on('close', () => cleanup('REMOTE_DISCONNECT'));
  }

  private async drainFrames(reader: ByteReader, ctx: TcpConnectionContext): Promise<void> {
    const { adapter } = ctx;
    // Frame up to a bounded number of packets per data event to avoid starving
    // other sockets under a large multi-frame burst.
    const MAX_PER_DRAIN = 64;
    for (let i = 0; i < MAX_PER_DRAIN; i++) {
      const framed = adapter.frame(reader, new Date());
      if (framed === NEED_MORE) {
        // Reset the idle timer: we received bytes even if no complete frame yet.
        ctx.socket.setTimeout(this.options.idleTimeoutMs);
        return;
      }
      // Framed — refresh liveness and forward the raw bytes to the dispatcher.
      ctx.session.touch();
      ctx.socket.setTimeout(this.options.idleTimeoutMs);
      const ok = await this.options.onPacket(ctx, Buffer.from(framed.payload));
      if (!ok) {
        // Back-pressure: stop draining this event; the dispatcher will resume.
        return;
      }
    }
  }
}

/**
 * TcpServer — owns a set of TcpListeners (one per enabled protocol) and manages
 * their lifecycle. The gateway composes one of these.
 */
export class TcpServer implements OnApplicationShutdown {
  private readonly logger = new Logger(TcpServer.name);
  private readonly listeners = new Map<string, TcpListener>();

  public add(id: string, listener: TcpListener): void {
    this.listeners.set(id, listener);
  }

  public async startAll(): Promise<void> {
    const entries = [...this.listeners.entries()];
    const results = await Promise.allSettled(entries.map(([, l]) => l.listen()));
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? entries[i]?.[0] : null))
      .filter((x): x is string => x !== null);
    if (failed.length > 0) {
      // Non-fatal: a failed listener is logged but does not stop the others
      // (06 §15.4 — degrade rather than crash). The admin API surfaces status.
      this.logger.warn(`Some TCP listeners failed to start: ${failed.join(', ')}.`);
    }
  }

  public async stopAll(): Promise<void> {
    await Promise.allSettled([...this.listeners.values()].map((l) => l.close()));
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.stopAll();
  }
}

// re-export for callers that compare against the byte-reader NEED_MORE symbol.
export { NEED_MORE } from './byte-reader.js';
export { ByteReader } from './byte-reader.js';
