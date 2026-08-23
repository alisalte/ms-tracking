import { describe, expect, it } from '@jest/globals';
import {
  DataTypes,
  PacketFlags,
  PayloadTypes,
  buildMediaPacket,
  parseMediaPacket,
} from '@fleetvision/meitrack-media-protocol';
import { AccessUnitAssembler, isVideoPacket, splitNalus } from '../nal.js';

const IMEI = '867191086416152';

const SC = Buffer.from([0x00, 0x00, 0x00, 0x01]);

function mediaPacket(
  payload: Buffer,
  opts: { dataType?: number; packetFlag?: number; payloadType?: number; channel?: number } = {},
) {
  const buf = buildMediaPacket({
    imei: IMEI,
    channel: opts.channel ?? 1,
    dataType: opts.dataType ?? DataTypes.I_FRAME,
    packetFlag: opts.packetFlag ?? PacketFlags.COMPLETE,
    payloadType: opts.payloadType ?? PayloadTypes.H264,
    packetNo: 1,
    timestamp: Date.now(),
    payload,
  });
  const res = parseMediaPacket(buf);
  if (res.status !== 'ok') throw new Error('fixture packet failed to parse');
  return res.packet;
}

describe('isVideoPacket (the audio-in-video quirk guard)', () => {
  it('accepts I/P frames with H264/H265 payload types', () => {
    expect(isVideoPacket(mediaPacket(Buffer.alloc(8), { dataType: DataTypes.I_FRAME }))).toBe(true);
    expect(isVideoPacket(mediaPacket(Buffer.alloc(8), { dataType: DataTypes.P_FRAME }))).toBe(true);
    expect(
      isVideoPacket(mediaPacket(Buffer.alloc(8), { payloadType: PayloadTypes.H265 })),
    ).toBe(true);
  });

  it('rejects audio/GPS payload types and audio/B data types', () => {
    // The MD300 sends audio frames with payloadType=H264 but dataType=Audio.
    expect(
      isVideoPacket(mediaPacket(Buffer.alloc(8), { dataType: DataTypes.AUDIO_FRAME })),
    ).toBe(false);
    expect(isVideoPacket(mediaPacket(Buffer.alloc(8), { dataType: DataTypes.B_FRAME }))).toBe(false);
    expect(
      isVideoPacket(mediaPacket(Buffer.alloc(8), { payloadType: PayloadTypes.G711A_AUDIO })),
    ).toBe(false);
    expect(
      isVideoPacket(mediaPacket(Buffer.alloc(8), { payloadType: PayloadTypes.GPS_DATA })),
    ).toBe(false);
  });
});

describe('splitNalus', () => {
  it('splits at 3- and 4-byte start codes', () => {
    const buf = Buffer.concat([
      SC,
      Buffer.from([0x67, 1, 2]), // SPS
      Buffer.from([0x00, 0x00, 0x01]), // 3-byte code
      Buffer.from([0x68, 4]), // PPS
      SC,
      Buffer.from([0x65, 9, 9, 9]), // IDR
    ]);
    const nalus = splitNalus(buf);
    expect(nalus.length).toBe(3);
    expect([...nalus[0]!]).toEqual([0x67, 1, 2]);
    expect([...nalus[1]!]).toEqual([0x68, 4]);
    expect([...nalus[2]!]).toEqual([0x65, 9, 9, 9]);
  });

  it('returns [] for payloads without start codes (AVCC)', () => {
    expect(splitNalus(Buffer.from([0x00, 0x00, 0x02, 0x67, 1]))).toEqual([]);
  });
});

describe('AccessUnitAssembler (the MD300 COMPLETE + fragments cycle)', () => {
  const keyframe = Buffer.concat([SC, Buffer.from([0x67, ...Array(60).fill(1)]), SC, Buffer.from([0x68, 2]), SC, Buffer.from([0x65, ...Array(300).fill(3)])]);
  const frag = (n: number) => Buffer.concat([SC, Buffer.from([0x21, n])]);

  it('flushes [COMPLETE + fragments] when the next COMPLETE arrives', () => {
    const asm = new AccessUnitAssembler();

    // Cycle 1: COMPLETE keyframe + 3 fragments.
    expect(asm.feed(mediaPacket(keyframe, { dataType: DataTypes.P_FRAME, packetFlag: PacketFlags.COMPLETE }))).toBeNull();
    expect(asm.feed(mediaPacket(frag(1), { dataType: DataTypes.I_FRAME, packetFlag: PacketFlags.FIRST }))).toBeNull();
    expect(asm.feed(mediaPacket(frag(2), { dataType: DataTypes.I_FRAME, packetFlag: PacketFlags.MIDDLE }))).toBeNull();
    expect(asm.feed(mediaPacket(frag(3), { dataType: DataTypes.I_FRAME, packetFlag: PacketFlags.LAST }))).toBeNull();

    // Cycle 2's COMPLETE flushes cycle 1 as one access unit.
    const unit = asm.feed(mediaPacket(keyframe, { dataType: DataTypes.P_FRAME, packetFlag: PacketFlags.COMPLETE }));
    expect(unit).not.toBeNull();
    expect(unit!.length).toBe(keyframe.length + frag(1).length + frag(2).length + frag(3).length);
    // Order: complete first, then fragments.
    expect(unit!.subarray(0, keyframe.length).equals(keyframe)).toBe(true);
  });

  it('keeps channels independent', () => {
    const asm = new AccessUnitAssembler();
    expect(asm.feed(mediaPacket(keyframe, { channel: 1, packetFlag: PacketFlags.COMPLETE }))).toBeNull();
    // Channel 2's COMPLETE must not flush channel 1's open cycle.
    expect(asm.feed(mediaPacket(keyframe, { channel: 2, packetFlag: PacketFlags.COMPLETE }))).toBeNull();
    // Channel 1's next COMPLETE flushes ONLY channel 1's stored keyframe
    // (channel 2's cycle stays pending for its own next COMPLETE).
    const unit = asm.feed(mediaPacket(keyframe, { channel: 1, packetFlag: PacketFlags.COMPLETE }));
    expect(unit!.length).toBe(keyframe.length);
  });

  it('reset clears in-flight state', () => {
    const asm = new AccessUnitAssembler();
    asm.feed(mediaPacket(keyframe, { packetFlag: PacketFlags.COMPLETE }));
    asm.feed(mediaPacket(frag(1), { packetFlag: PacketFlags.FIRST }));
    asm.reset();
    // After reset the stored COMPLETE is gone: next COMPLETE flushes nothing.
    expect(asm.feed(mediaPacket(keyframe, { packetFlag: PacketFlags.COMPLETE }))).toBeNull();
  });
});
