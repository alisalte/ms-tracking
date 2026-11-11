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
import { DETECTION_THRESHOLD } from '../protocol/adapter-registry.js';
import type { ProtocolAdapter } from '../protocol/protocol-adapter.js';
import { ByteReader, NEED_MORE } from './byte-reader.js';

/**
 * Bytes of the first TCP chunk written to the log. A live MD300 CCE frame is
 * about 150–170 bytes; 80 hid the tail where CAN and the n-byte group sit.
 */
const FIRST_CHUNK_LOG_BYTES = 512;

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
 * runs them through the dispatcher. Returning false means the session was closed
 * and the read loop must stop; a failed dispatch of one frame returns true so the
 * frames behind it are still processed.
 */
export type TcpPacketHandler = (ctx: TcpConnectionContext, packet: Buffer) => Promise<boolean>;

/**
 * Bytes a multiplexed listener will buffer while waiting for one candidate
 * adapter to recognise the connection. The longest signature is Teltonika's
 * 17-byte IMEI frame; a client that has sent this much without matching is not
 * speaking any candidate protocol.
 */
const MAX_DETECT_BYTES = 64;

export interface TcpListenerOptions {
  /** Dedicated listener: every connection speaks this protocol. */
  readonly adapter?: ProtocolAdapter;
  /**
   * Multiplexed listener (06 §2.3): several protocols share the port. The first
   * bytes of each connection are peeked and the best-matching candidate (above
   * the detection threshold) parses the whole connection. The session is opened
   * only once the protocol is known. Exactly one of `adapter` / `candidates`.
   */
  readonly candidates?: readonly ProtocolAdapter[];
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
    if (!options.adapter === !options.candidates) {
      throw new Error('TcpListener needs exactly one of `adapter` or `candidates`.');
    }
    this.logger = new Logger(`TcpListener:${this.label}`);
  }

  /** Listener name for logs: the adapter id, or `a+b` for a multiplexed port. */
  private get label(): string {
    return this.options.adapter?.id ?? (this.options.candidates ?? []).map((a) => a.id).join('+');
  }

  /** Bind and begin accepting. Resolves when listening. */
  public async listen(): Promise<void> {
    const { port, host } = this.options;
    const server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host ?? '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.logger.log(`Listening on ${host ?? '0.0.0.0'}:${port} [${this.label}].`);
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
    socket.setNoDelay(true);
    socket.setTimeout(this.options.idleTimeoutMs);
    if (this.options.adapter) {
      this.attach(socket, this.options.adapter, null);
    } else {
      this.detectThenAttach(socket);
    }
  }

  /** Best candidate for the bytes seen so far, or null while undecided. */
  private detect(peek: Buffer): ProtocolAdapter | null {
    let best: { adapter: ProtocolAdapter; confidence: number } | null = null;
    for (const adapter of this.options.candidates ?? []) {
      const { confidence } = adapter.detect(peek);
      if (confidence > (best?.confidence ?? -1)) best = { adapter, confidence };
    }
    return best && best.confidence >= DETECTION_THRESHOLD ? best.adapter : null;
  }

  /**
   * Multiplexed port: buffer the opening bytes until one candidate recognises
   * them, then hand the socket (and the buffered bytes) to that adapter. No
   * session exists yet, so an unrecognised or silent client costs nothing.
   */
  private detectThenAttach(socket: Socket): void {
    const remote = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`;
    let head = Buffer.alloc(0);
    const stop = () => {
      socket.off('data', onData);
      socket.off('error', onFail);
      socket.off('close', onFail);
      socket.off('timeout', onFail);
    };
    // Diagnostics: an unrecognised or silent client leaves no session, so log
    // the connection itself and what (if anything) it sent before giving up.
    this.logger.log(
      `Shared-port connection from ${remote} [${this.label}] — waiting for first bytes.`,
    );
    const onFail = () => {
      stop();
      const seen =
        head.length > 0
          ? `${head.length}B received hex=${head.subarray(0, 32).toString('hex')}`
          : 'no bytes received';
      this.logger.warn(
        `Shared-port connection from ${remote} [${this.label}] ended before detection: ${seen}`,
      );
      socket.destroy();
    };
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const adapter = this.detect(head);
      if (adapter) {
        stop();
        this.logger.log(`Detected ${adapter.id} from ${remote} on shared port.`);
        this.attach(socket, adapter, head);
        return;
      }
      if (head.length >= MAX_DETECT_BYTES) {
        this.logger.warn(
          `Unrecognised protocol from ${remote} [${this.label}] — closing. ` +
            `hex=${head.subarray(0, 32).toString('hex')}`,
        );
        onFail();
      }
    };
    socket.on('data', onData);
    socket.on('error', onFail);
    socket.on('close', onFail);
    socket.on('timeout', onFail);
  }

  /** Open the session and run the read → frame → dispatch loop for `adapter`. */
  private attach(socket: Socket, adapter: ProtocolAdapter, initial: Buffer | null): void {
    const remoteAddress = socket.remoteAddress ?? 'unknown';
    const remotePort = socket.remotePort ?? 0;
    const { openSession, onClose, onOpen, onError, onIdleTimeout } = this.options;

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

    // Drains are chained per connection: a second 'data' event arriving while a
    // dispatch is awaiting Kafka must wait its turn, otherwise two loops race on
    // the same reader and frames reach Kafka out of order.
    let draining: Promise<void> = Promise.resolve();
    let loggedFirstBytes = false;
    const onChunk = (chunk: Buffer) => {
      if (!loggedFirstBytes) {
        loggedFirstBytes = true;
        const preview = chunk.subarray(0, FIRST_CHUNK_LOG_BYTES);
        this.logger.log(
          `First ${chunk.length}B from ${remoteAddress}:${remotePort} session=${session.id}: ` +
            `hex=${preview.toString('hex')} ascii=${JSON.stringify(preview.toString('latin1'))}`,
        );
      }
      reader.append(chunk);
      draining = draining
        .then(() => this.drainFrames(reader, ctx))
        .catch((err) => onError?.(ctx, err as Error));
    };
    socket.on('data', onChunk);
    // Bytes consumed while detecting the protocol are replayed into the reader.
    if (initial) onChunk(initial);

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
    // Yield to the event loop every YIELD_EVERY frames so a large multi-frame
    // burst (a unit flushing its offline backlog) cannot starve other sockets.
    // The loop itself only ends on NEED_MORE: stopping after a fixed number of
    // frames left the tail of the burst in the reader until the device happened
    // to send again — and lost it outright if the socket closed first.
    const YIELD_EVERY = 64;
    for (let i = 1; ; i++) {
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
        // The handler closed the session — nothing further may be dispatched.
        return;
      }
      if (i % YIELD_EVERY === 0) await new Promise<void>((resolve) => setImmediate(resolve));
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
