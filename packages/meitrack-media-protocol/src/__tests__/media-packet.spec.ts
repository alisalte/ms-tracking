import { describe, expect, it } from '@jest/globals';
import type { MeitrackMediaPacket } from '../media-packet.js';
import {
  DataTypes,
  PacketFlags,
  PayloadTypes,
  buildMediaPacket,
  findPacketStart,
  parseMediaPacket,
} from '../media-packet.js';

const IMEI = '867191086416152';

function samplePacket(payload: Buffer, overrides: Partial<Parameters<typeof buildMediaPacket>[0]> = {}): Buffer {
  return buildMediaPacket({
    imei: IMEI,
    channel: 1,
    dataType: DataTypes.I_FRAME,
    packetFlag: PacketFlags.COMPLETE,
    payloadType: PayloadTypes.H264,
    packetNo: 42,
    timestamp: 1_700_000_000_000,
    payload,
    ...overrides,
  });
}

describe('parseMediaPacket', () => {
  it('parses a complete packet with the documented header layout', () => {
    const payload = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1f]); // SPS-ish NAL
    const buf = samplePacket(payload);
    const res = parseMediaPacket(buf);

    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    const p: MeitrackMediaPacket = res.packet;

    expect(p.imei).toBe(IMEI);
    expect(p.channel).toBe(1);
    expect(p.payloadType).toBe(PayloadTypes.H264);
    expect(p.payloadTypeStr).toBe('H264');
    expect(p.dataType).toBe(DataTypes.I_FRAME);
    expect(p.packetFlag).toBe(PacketFlags.COMPLETE);
    expect(p.packetFlagStr).toBe('Complete');
    expect(p.packetNo).toBe(42);
    expect(p.timestamp).toBe(1_700_000_000_000);
    expect(p.dataLength).toBe(payload.length);
    expect(p.totalLength).toBe(28 + payload.length);
    expect(p.payload.equals(payload)).toBe(true);
  });

  it('reports incomplete when fewer bytes than the header are buffered', () => {
    const res = parseMediaPacket(Buffer.from([0x12, 0xc4, 0x00]));
    expect(res).toEqual({ status: 'incomplete', need: 28 });
  });

  it('reports incomplete when the body has not fully arrived (split TCP segments)', () => {
    const buf = samplePacket(Buffer.alloc(950, 0xab));
    const res = parseMediaPacket(buf.subarray(0, buf.length - 100));
    expect(res).toEqual({ status: 'incomplete', need: buf.length });
  });

  it('reports invalid when the first byte is not 0x12', () => {
    const res = parseMediaPacket(Buffer.alloc(64, 0x00));
    expect(res).toEqual({ status: 'invalid' });
  });

  it('decodes the m_pt payloadType<<1 encoding and packet flags', () => {
    const buf = samplePacket(Buffer.alloc(4), {
      payloadType: PayloadTypes.H265,
      dataType: DataTypes.P_FRAME,
      packetFlag: PacketFlags.FIRST,
    });
    const res = parseMediaPacket(buf);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.packet.payloadType).toBe(PayloadTypes.H265);
    expect(res.packet.payloadTypeStr).toBe('H265');
    expect(res.packet.dataTypeStr).toBe('P-Frame');
    expect(res.packet.packetFlagStr).toBe('First');
  });

  it('round-trips a realistic sequence of fragments', () => {
    // One COMPLETE keyframe + 3 FIRST/MIDDLE/LAST fragments, like the MD300 cycle.
    const parts = [
      { packetFlag: PacketFlags.COMPLETE, dataType: DataTypes.P_FRAME, body: Buffer.alloc(950, 1) },
      { packetFlag: PacketFlags.FIRST, dataType: DataTypes.I_FRAME, body: Buffer.alloc(200, 2) },
      { packetFlag: PacketFlags.MIDDLE, dataType: DataTypes.I_FRAME, body: Buffer.alloc(950, 3) },
      { packetFlag: PacketFlags.LAST, dataType: DataTypes.I_FRAME, body: Buffer.alloc(120, 4) },
    ];
    let seq = 100;
    const stream = Buffer.concat(
      parts.map((p) =>
        samplePacket(p.body, { packetFlag: p.packetFlag, dataType: p.dataType, packetNo: seq++ }),
      ),
    );

    let off = 0;
    const seen: string[] = [];
    while (off < stream.length) {
      const res = parseMediaPacket(stream.subarray(off));
      expect(res.status).toBe('ok');
      if (res.status !== 'ok') break;
      seen.push(res.packet.packetFlagStr);
      off += res.packet.totalLength;
    }
    expect(seen).toEqual(['Complete', 'First', 'Middle', 'Last']);
  });
});

describe('findPacketStart', () => {
  it('locates the 0x12 flag after junk bytes', () => {
    const junk = Buffer.from([0x00, 0xff, 0x10]);
    const pkt = samplePacket(Buffer.alloc(8));
    expect(findPacketStart(Buffer.concat([junk, pkt]))).toBe(junk.length);
  });

  it('returns -1 when no flag exists', () => {
    expect(findPacketStart(Buffer.alloc(16, 0x00))).toBe(-1);
  });
});
