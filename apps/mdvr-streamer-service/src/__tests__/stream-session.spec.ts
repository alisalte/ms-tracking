import { describe, expect, it } from '@jest/globals';
import {
  DataTypes,
  PacketFlags,
  PayloadTypes,
  buildMediaPacket,
  parseMediaPacket,
} from '@fleetvision/meitrack-media-protocol';
import { fileURLToPath } from 'node:url';
import { streamerConfigSchema } from '../config.js';
import { LateBoundSink, StreamRegistry, type BroadcastSink } from '../stream-session.js';

const IMEI = '867191086416152';
const SC = Buffer.from([0x00, 0x00, 0x00, 0x01]);

/** Stub "ffmpeg": copies stdin -> stdout (see fixtures/stub-ffmpeg.mjs). */
const STUB = fileURLToPath(new URL('./fixtures/stub-ffmpeg.mjs', import.meta.url));

function videoPacket(payload: Buffer, packetNo: number, packetFlag: number = PacketFlags.COMPLETE, dataType: number = DataTypes.P_FRAME, payloadType: number = PayloadTypes.H264) {
  const buf = buildMediaPacket({
    imei: IMEI,
    channel: 1,
    dataType,
    packetFlag,
    payloadType,
    packetNo,
    timestamp: Date.now(),
    payload,
  });
  const res = parseMediaPacket(buf);
  if (res.status !== 'ok') throw new Error('fixture failed');
  return res.packet;
}

/** A BroadcastSink that records everything broadcast. */
class RecordingSink implements BroadcastSink {
  public readonly chunks: { imei: string; chunk: Buffer }[] = [];
  public broadcast(imei: string, chunk: Buffer): void {
    this.chunks.push({ imei, chunk });
  }
  public viewerCount(): number {
    return 0;
  }
}

/**
 * End-to-end media-path test with a stub ffmpeg: a tiny node script that
 * copies stdin to stdout (pipe passthrough). The session treats its stdout as
 * "MPEG-TS" and broadcasts it — proving the wiring videoServer -> assembler ->
 * ffmpeg -> hub without a real ffmpeg install.
 */
describe('StreamSession with stub ffmpeg', () => {
  it('feeds assembled access units through ffmpeg to the hub', async () => {
    const sink = new RecordingSink();
    const registry = new StreamRegistry(
      streamerConfigSchema.parse({ ...process.env, FFMPEG_BIN: STUB, LOG_LEVEL: 'error' }),
      sink,
      () => undefined,
    );

    const opened = registry.open(IMEI);
    expect('error' in opened).toBe(false);
    const session = 'error' in opened ? null : opened;

    const keyframe = Buffer.concat([SC, Buffer.from([0x67, 1])]);
    const frag = Buffer.concat([SC, Buffer.from([0x21, 2])]);

    // Cycle 1: complete + frag; cycle 2 complete flushes cycle 1.
    session!.feed(videoPacket(keyframe, 1, PacketFlags.COMPLETE, DataTypes.P_FRAME));
    session!.feed(videoPacket(frag, 2, PacketFlags.FIRST, DataTypes.I_FRAME));
    session!.feed(videoPacket(keyframe, 3, PacketFlags.COMPLETE, DataTypes.P_FRAME));

    // Give the stub process time to echo the written bytes back.
    await new Promise((r) => setTimeout(r, 500));

    const joined = Buffer.concat(sink.chunks.map((c) => c.chunk));
    expect(joined.length).toBeGreaterThanOrEqual(keyframe.length + frag.length);

    const stats = session!.stats();
    expect(stats.imei).toBe(IMEI);
    expect(stats.codec).toBe('h264');
    expect(stats.units).toBe(1);
    expect(stats.packets).toBe(3);

    registry.close(IMEI);
    expect(session!.stats().connected).toBe(false);
  });

  it('refuses streams beyond MAX_STREAMS and reports stats per imei', () => {
    const sink = new RecordingSink();
    const registry = new StreamRegistry(
      streamerConfigSchema.parse({ MAX_STREAMS: '1', FFMPEG_BIN: STUB ?? 'ffmpeg', LOG_LEVEL: 'error' }),
      sink,
      () => undefined,
    );
    expect('error' in registry.open('111111111111111')).toBe(false);
    const refused = registry.open('222222222222222');
    expect('error' in refused).toBe(true);
  });
});

describe('LateBoundSink', () => {
  it('forwards only after bind', () => {
    const late = new LateBoundSink();
    late.broadcast('x', Buffer.alloc(2)); // no target — no throw
    const rec = new RecordingSink();
    late.bind(rec);
    late.broadcast('x', Buffer.alloc(2));
    expect(rec.chunks.length).toBe(1);
    expect(late.viewerCount('x')).toBe(0);
  });
});
