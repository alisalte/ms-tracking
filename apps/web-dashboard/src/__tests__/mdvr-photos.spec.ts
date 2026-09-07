import { describe, expect, it } from 'vitest';

import { fromMdvrBcdTime } from '@/api/video.api';
import { mergeMdvrPhotoFilenames } from '@/components/video/useMdvrResources';

describe('mergeMdvrPhotoFilenames', () => {
  it('attaches a D01 name to an AB8 photo row by BCD start time', () => {
    const startTime = '240823120009';
    const capturedAt = fromMdvrBcdTime(startTime);
    const merged = mergeMdvrPhotoFilenames(
      [
        {
          channel: 2,
          startTime,
          endTime: startTime,
          avType: 4,
          streamType: 0,
          capType: 0,
          fileLen: 1024,
          eventCode: 126,
          subEventCode: 8,
        },
      ],
      ['240823120009_CH2_E126S8_0.jpg'],
      { logicalChannel: 2, fromMs: capturedAt - 60_000, toMs: capturedAt + 60_000 },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.filename).toBe('240823120009_CH2_E126S8_0.jpg');
  });

  it('adds leftover D01 names that fall inside the search window', () => {
    const startTime = '240823120009';
    const capturedAt = fromMdvrBcdTime(startTime);
    const merged = mergeMdvrPhotoFilenames([], [`${startTime}_CH1_E126S8_0.jpg`], {
      logicalChannel: 1,
      fromMs: capturedAt - 1_000,
      toMs: capturedAt + 1_000,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.filename).toBe(`${startTime}_CH1_E126S8_0.jpg`);
    expect(merged[0]?.channel).toBe(1);
  });

  it('adds leftover D01 names even outside the search window', () => {
    const startTime = '240823120009';
    const capturedAt = fromMdvrBcdTime(startTime);
    const merged = mergeMdvrPhotoFilenames(
      [],
      [`${startTime}_CH1_E126S8_0.jpg`, 'event_snap.jpg'],
      { logicalChannel: 1, fromMs: capturedAt + 10_000, toMs: capturedAt + 20_000 },
    );
    expect(merged.map((r) => r.filename)).toEqual([
      'event_snap.jpg',
      `${startTime}_CH1_E126S8_0.jpg`,
    ]);
  });

  it('skips leftover D01 names tagged for a different camera', () => {
    const startTime = '240823120009';
    const capturedAt = fromMdvrBcdTime(startTime);
    expect(
      mergeMdvrPhotoFilenames([], [`${startTime}_CH2_E126S8_0.jpg`], {
        logicalChannel: 1,
        fromMs: capturedAt - 1_000,
        toMs: capturedAt + 1_000,
      }),
    ).toEqual([]);
  });
});
