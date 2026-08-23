/**
 * FFmpegProcess — one ffmpeg child per device stream.
 *
 * stdin  : raw Annex-B H.264/H.265 NAL units (assembled access units)
 * stdout : low-latency MPEG-TS carrying MPEG-1 video — the codec JSMpeg's
 *           software decoder natively supports (it has NO H.264 decoder).
 *
 * Why transcode instead of `-c copy`: the MD300's H.264 bitstream is
 * non-standard — COMPLETE packets carry partial-MB IDR slices and FIRST
 * fragments carry type-1 slices with different starting macroblock addresses.
 * The raw h264 demuxer emits each NAL as a separate frame; decoding through
 * libx264 reassembles the partial slices and produces clean keyframes that
 * JSMpeg (baseline decoder) can render. This is the configuration validated
 * against a real MD300 in the standalone pipeline this service ports.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

/** 4-byte Annex-B start code prepended to bare access units. */
const ANNEX_B = Buffer.from([0x00, 0x00, 0x00, 0x01]);

export interface FfmpegEvents extends EventEmitter {
  /** A chunk of MPEG-TS bytes from stdout — forward to viewers. */
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  emit(event: 'data', chunk: Buffer): boolean;
  emit(event: 'exit', code: number | null, signal: NodeJS.Signals | null): boolean;
  emit(event: 'error', err: Error): boolean;
}

export class FFmpegProcess {
  public readonly events: FfmpegEvents = new EventEmitter();
  private proc: ChildProcessWithoutNullStreams | null = null;
  private _producing = false;

  public constructor(
    private readonly ffmpegBin: string,
    private readonly codec: 'h264' | 'hevc',
    private readonly log: (msg: string) => void,
  ) {}

  /** Whether ffmpeg has produced TS output at least once. */
  public get producing(): boolean {
    return this._producing;
  }

  public get running(): boolean {
    return this.proc !== null;
  }

  /** Spawn ffmpeg for the configured codec. No-op when already running. */
  public start(): void {
    if (this.proc) return;
    // Demuxer must match the codec: H.265 VPS/SPS/PPS NALs are rejected by the
    // h264 demuxer. JSMpeg decodes H.264 only, so H.265 must be transcoded.
    const demuxer = this.codec === 'hevc' ? 'hevc' : 'h264';
    // JSMpeg's decoder is MPEG-1 ONLY (no H.264) — transcode to mpeg1video.
    // mpeg1video needs standard framerates; -r 24 normalizes odd camera rates.
    const videoArgs = [
      '-c:v',
      'mpeg1video',
      '-r',
      '24',
      '-b:v',
      '1M',
      '-maxrate',
      '1M',
      '-bufsize',
      '1M',
      '-bf',
      '0',
    ];
    const args = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-fflags',
      '+nobuffer+genpts',
      '-flags',
      'low_delay',
      '-use_wallclock_as_timestamps',
      '1',
      '-f',
      demuxer,
      '-i',
      'pipe:0',
      ...videoArgs,
      '-an',
      '-f',
      'mpegts',
      '-flush_packets',
      '1',
      '-muxdelay',
      '0',
      '-pcr_period',
      '20',
      'pipe:1',
    ];

    this.log(`spawning ${this.ffmpegBin} (${demuxer} stdin -> mpegts stdout)`);
    this._producing = false;
    try {
      this.proc = spawn(this.ffmpegBin, args, { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    } catch (err) {
      this.log(`spawn error: ${(err as Error).message}`);
      this.proc = null;
      this.events.emit('error', err as Error);
      return;
    }
    const proc = this.proc;

    proc.stdout.on('data', (chunk: Buffer) => {
      if (!this._producing) {
        this._producing = true;
        this.log('producing MPEG-TS output');
      }
      this.events.emit('data', chunk);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) this.log(line);
    });
    proc.on('error', (err) => {
      this.log(`process error: ${err.message}`);
      this.proc = null;
      this.events.emit('error', err);
    });
    proc.on('exit', (code, signal) => {
      this.log(`exited code=${code} sig=${signal}`);
      this.proc = null;
      this._producing = false;
      this.events.emit('exit', code, signal);
    });
  }

  /**
   * Write an access unit (Annex-B NALs). When the unit already starts with a
   * start code it is passed through; otherwise ours is prepended.
   */
  public write(unit: Buffer): void {
    const proc = this.proc;
    if (!proc || proc.stdin.destroyed || !proc.stdin.writable) return;
    const hasStartCode =
      unit.length >= 3 &&
      unit[0] === 0 &&
      unit[1] === 0 &&
      (unit[2] === 1 || (unit.length >= 4 && unit[2] === 0 && unit[3] === 1));
    const buf = hasStartCode ? unit : Buffer.concat([ANNEX_B, unit]);
    proc.stdin.write(buf);
  }

  /** Best-effort teardown. */
  public stop(): void {
    const proc = this.proc;
    this.proc = null;
    this._producing = false;
    if (!proc) return;
    try {
      proc.stdin.end();
    } catch {
      /* already closed */
    }
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
}
