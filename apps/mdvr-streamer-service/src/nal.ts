/**
 * H.264/H.265 NAL extraction + access-unit reassembly (pure, unit-testable).
 *
 * Ported from the proven standalone pipeline, where two MD300 quirks were
 * discovered against a real device:
 *
 *  1. Some "audio" frames arrive with payloadType=H264 but dataType=Audio/B —
 *     they must be dropped BEFORE reassembly or they corrupt the bitstream.
 *     Only I-Frame (0) and P-Frame (1) data types carry real video.
 *
 *  2. The per-cycle pattern is: a COMPLETE packet holding a self-contained
 *     SPS+PPS+IDR keyframe (~950B), followed by ~450 FIRST/MIDDLE/LAST
 *     fragments that are standalone NAL type-1 slices completing the image.
 *     The working strategy: buffer fragments, and when the NEXT COMPLETE
 *     arrives, flush [previous COMPLETE + fragments] as one access unit.
 *     Every part already carries its own Annex-B start code.
 */
import { DataTypes, PayloadTypes, type MeitrackMediaPacket } from '@fleetvision/meitrack-media-protocol';

/** 4-byte Annex-B start code prepended to bare NAL units. */
export const ANNEX_B_START_CODE = Buffer.from([0x00, 0x00, 0x00, 0x01]);

/**
 * Whether a media packet carries decodable video (the audio-in-video quirk
 * guard — see module doc §1).
 */
export function isVideoPacket(pkt: MeitrackMediaPacket): boolean {
  if (pkt.payloadType !== PayloadTypes.H264 && pkt.payloadType !== PayloadTypes.H265) {
    return false; // audio (G.726/G.711A) or GPS — not forwarded
  }
  return pkt.dataType === DataTypes.I_FRAME || pkt.dataType === DataTypes.P_FRAME;
}

/** Codec implied by a packet's payload type. */
export function codecOfPacket(pkt: MeitrackMediaPacket): 'h264' | 'hevc' {
  return pkt.payloadType === PayloadTypes.H265 ? 'hevc' : 'h264';
}

/**
 * Split a raw H.264/H.265 byte stream into individual NAL units at 3- and
 * 4-byte Annex-B start codes. Returns [] when no start code exists (the
 * payload may be length-prefixed AVCC — callers feed it raw).
 */
export function splitNalus(buf: Buffer): Buffer[] {
  const nalus: Buffer[] = [];
  let i = 0;
  let naluStart = -1;

  while (i < buf.length) {
    let scLen = 0;
    if (i + 4 <= buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) {
      scLen = 4;
    } else if (i + 3 <= buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      scLen = 3;
    }
    if (scLen > 0) {
      if (naluStart >= 0) nalus.push(buf.subarray(naluStart, i));
      naluStart = i + scLen;
      i += scLen;
    } else {
      i++;
    }
  }
  if (naluStart >= 0 && naluStart < buf.length) {
    nalus.push(buf.subarray(naluStart));
  }
  return nalus;
}

/** Per-channel access-unit assembly state. */
interface ChannelPending {
  complete: Buffer | null;
  frags: Buffer[];
}

/**
 * Reassembles the MD300 COMPLETE + fragment cycle into access units.
 *
 * feed() returns the flushed access unit (a single Buffer, parts already
 * start-code prefixed) or null when more packets are needed. The packet must
 * already have passed isVideoPacket().
 */
export class AccessUnitAssembler {
  private readonly pending = new Map<number, ChannelPending>();

  /**
   * Feed one video packet. When its COMPLETE closes a previous cycle, the
   * previous cycle's unit [COMPLETE + fragments] is returned.
   */
  public feed(pkt: MeitrackMediaPacket): Buffer | null {
    const ch = pkt.channel;
    let entry = this.pending.get(ch);

    if (pkt.packetFlag === 0 /* PacketFlags.COMPLETE */) {
      const flushable = entry && (entry.complete || entry.frags.length > 0) ? entry : null;
      entry = { complete: pkt.payload, frags: [] };
      this.pending.set(ch, entry);
      if (flushable) {
        const parts: Buffer[] = [];
        if (flushable.complete) parts.push(flushable.complete);
        parts.push(...flushable.frags);
        return Buffer.concat(parts);
      }
      return null;
    }

    // FIRST / MIDDLE / LAST — accumulate fragments for the open cycle.
    if (!entry) {
      entry = { complete: null, frags: [] };
      this.pending.set(ch, entry);
    }
    entry.frags.push(pkt.payload);
    return null;
  }

  /** Drop all in-flight state (device disconnect / resync). */
  public reset(): void {
    this.pending.clear();
  }
}

/** Human-readable NAL type summary for logs (H.264: low 5 bits). */
export function summarizeNaluTypes(buf: Buffer, codec: 'h264' | 'hevc'): string {
  const nalus = splitNalus(buf);
  return nalus
    .map((n) => {
      const t = codec === 'hevc' ? `n${(n[0]! >> 1) & 0x3f}` : String(n[0]! & 0x1f);
      return `${t}(${n.length}B)`;
    })
    .join(',');
}
