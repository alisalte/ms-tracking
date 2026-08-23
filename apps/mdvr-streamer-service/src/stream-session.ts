/**
 * StreamSession — one live device media stream (per IMEI).
 *
 * Wires the reassembled access units into an FFmpegProcess and forwards the
 * MPEG-TS output to the hub room for that IMEI. Tracks per-stream stats for
 * /status. Handles codec switches (H.264 <-> H.265) by restarting ffmpeg with
 * the matching demuxer.
 */
import type { MeitrackMediaPacket } from '@fleetvision/meitrack-media-protocol';
import type { StreamerConfig } from './config.js';
import { FFmpegProcess } from './ffmpeg.js';
import { AccessUnitAssembler, codecOfPacket, isVideoPacket, summarizeNaluTypes } from './nal.js';

/** What a session needs from the viewer plane (implemented by WsHub). */
export interface BroadcastSink {
  broadcast(imei: string, chunk: Buffer): void;
  viewerCount(imei: string): number;
}

export interface StreamStats {
  imei: string;
  codec: 'h264' | 'hevc' | null;
  connected: boolean;
  /** True once ffmpeg has produced TS output at least once. */
  producing: boolean;
  packets: number;
  /** Access units flushed to ffmpeg. */
  units: number;
  bytesIn: number;
  startedAt: number;
  lastPacketAt: number | null;
  viewers: number;
}

export class StreamSession {
  private ffmpeg: FFmpegProcess | null = null;
  private codec: 'h264' | 'hevc' | null = null;
  private readonly assembler = new AccessUnitAssembler();
  private readonly startedAt = Date.now();
  private closed = false;

  private packets = 0;
  private units = 0;
  private bytesIn = 0;
  private lastPacketAt: number | null = null;

  public constructor(
    public readonly imei: string,
    private readonly config: StreamerConfig,
    private readonly sink: BroadcastSink,
    private readonly log: (tag: string, msg: string) => void,
  ) {}

  /** Feed one parsed media packet (any type; non-video is filtered here). */
  public feed(pkt: MeitrackMediaPacket): void {
    if (this.closed) return;
    this.packets++;
    this.bytesIn += pkt.dataLength;
    this.lastPacketAt = Date.now();

    if (!isVideoPacket(pkt)) return;

    const codec = codecOfPacket(pkt);
    if (this.codec !== codec) {
      this.log('VIDEO', `codec changed: ${this.codec ?? 'none'} -> ${codec} — restarting ffmpeg`);
      this.codec = codec;
      this.stopFfmpeg();
    }

    const unit = this.assembler.feed(pkt);
    if (!unit) return;

    if (!this.ffmpeg) {
      this.ffmpeg = new FFmpegProcess(this.config.FFMPEG_BIN, codec, (m) => this.log('FFMPEG', m));
      this.ffmpeg.events.on('data', (chunk) => {
        this.sink.broadcast(this.imei, chunk);
      });
      this.ffmpeg.start();
    }
    if (this.config.LOG_LEVEL === 'debug') {
      this.log('VIDEO', `access unit ${unit.length}B [${summarizeNaluTypes(unit, codec)}]`);
    }
    this.ffmpeg.write(unit);
    this.units++;
  }

  /** Teardown on device disconnect. Viewers simply see the WS go quiet. */
  public close(): void {
    this.closed = true;
    this.assembler.reset();
    this.stopFfmpeg();
  }

  private stopFfmpeg(): void {
    if (this.ffmpeg) {
      this.ffmpeg.stop();
      this.ffmpeg = null;
    }
  }

  public stats(): StreamStats {
    return {
      imei: this.imei,
      codec: this.codec,
      connected: !this.closed,
      producing: this.ffmpeg?.producing ?? false,
      packets: this.packets,
      units: this.units,
      bytesIn: this.bytesIn,
      startedAt: this.startedAt,
      lastPacketAt: this.lastPacketAt,
      viewers: this.sink.viewerCount(this.imei),
    };
  }
}

/**
 * StreamRegistry — the active per-IMEI sessions plus the aggregate snapshot.
 */
export class StreamRegistry {
  private readonly sessions = new Map<string, StreamSession>();

  public constructor(
    private readonly config: StreamerConfig,
    private readonly sink: BroadcastSink,
    private readonly log: (tag: string, msg: string) => void,
  ) {}

  public get(imei: string): StreamSession | undefined {
    return this.sessions.get(imei);
  }

  /** Get or create the session for an IMEI (new device connection). */
  public open(imei: string): StreamSession | { error: string } {
    const existing = this.sessions.get(imei);
    if (existing) return existing;
    if (this.sessions.size >= this.config.MAX_STREAMS) {
      return { error: 'max concurrent streams reached' };
    }
    const session = new StreamSession(imei, this.config, this.sink, this.log);
    this.sessions.set(imei, session);
    return session;
  }

  public close(imei: string): void {
    const s = this.sessions.get(imei);
    if (!s) return;
    s.close();
    this.sessions.delete(imei);
  }

  public snapshot(): StreamStats[] {
    return [...this.sessions.values()].map((s) => s.stats());
  }
}

/**
 * LateBoundSink — the sink target exists only after the HTTP server builds the
 * WsHub; sessions broadcast at runtime, well after boot, so this indirection
 * keeps construction order simple without Proxy tricks.
 */
export class LateBoundSink implements BroadcastSink {
  private target: BroadcastSink | null = null;

  public bind(target: BroadcastSink): void {
    this.target = target;
  }

  public broadcast(imei: string, chunk: Buffer): void {
    this.target?.broadcast(imei, chunk);
  }

  public viewerCount(imei: string): number {
    return this.target?.viewerCount(imei) ?? 0;
  }
}
