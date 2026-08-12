/**
 * Codec strategy tests — the passthrough-vs-transcode decision (09 §6).
 *
 * decideCodec is a pure function; these tests pin the decision matrix so
 * accidental regressions in the transcode logic are caught.
 */
import { describe, expect, it } from '@jest/globals';

import { decideCodec } from '../domain/codec-strategy.js';
import type { StreamType } from '../domain/media-frame.js';

describe('decideCodec (09 §6)', () => {
  describe('RECORD mode always preserves the native codec', () => {
    const codecs: StreamType[] = ['H264', 'H265', 'AAC', 'OPUS', 'G711', 'G726'];
    for (const codec of codecs) {
      it(`passthrough for ${codec}`, () => {
        const decision = decideCodec(codec, 'RECORD');
        expect(decision.action).toBe('passthrough');
        expect(decision.outputCodec).toBe(codec);
      });
    }
  });

  describe('browser-native codecs pass through for live/playback/AI', () => {
    it('H264 → passthrough (browser-native video)', () => {
      const decision = decideCodec('H264', 'LIVE');
      expect(decision.action).toBe('passthrough');
      expect(decision.outputCodec).toBe('H264');
    });

    it('OPUS → passthrough (browser-native audio)', () => {
      const decision = decideCodec('OPUS', 'LIVE');
      expect(decision.action).toBe('passthrough');
      expect(decision.outputCodec).toBe('OPUS');
    });

    it('H264 → passthrough for PLAYBACK too', () => {
      const decision = decideCodec('H264', 'PLAYBACK');
      expect(decision.action).toBe('passthrough');
    });
  });

  describe('non-native codecs are transcoded to a browser-compatible target', () => {
    it('H265 → transcode to H264 for LIVE (browsers cannot decode H265)', () => {
      const decision = decideCodec('H265', 'LIVE');
      expect(decision.action).toBe('transcode');
      expect(decision.outputCodec).toBe('H264');
    });

    it('AAC → transcode to OPUS for LIVE (WebRTC needs Opus)', () => {
      const decision = decideCodec('AAC', 'LIVE');
      expect(decision.action).toBe('transcode');
      expect(decision.outputCodec).toBe('OPUS');
    });

    it('G711 → transcode to OPUS for LIVE', () => {
      const decision = decideCodec('G711', 'LIVE');
      expect(decision.action).toBe('transcode');
      expect(decision.outputCodec).toBe('OPUS');
    });

    it('G726 → transcode to OPUS for LIVE', () => {
      const decision = decideCodec('G726', 'LIVE');
      expect(decision.action).toBe('transcode');
      expect(decision.outputCodec).toBe('OPUS');
    });

    it('H265 → transcode to H264 for AI too', () => {
      const decision = decideCodec('H265', 'AI');
      expect(decision.action).toBe('transcode');
      expect(decision.outputCodec).toBe('H264');
    });
  });

  describe('decision carries a human-readable reason', () => {
    it('mentions the codec in a passthrough reason', () => {
      const decision = decideCodec('H264', 'LIVE');
      expect(decision.reason).toContain('H264');
    });

    it('mentions both codecs in a transcode reason', () => {
      const decision = decideCodec('H265', 'LIVE');
      expect(decision.reason).toContain('H265');
      expect(decision.reason).toContain('H264');
    });
  });
});
