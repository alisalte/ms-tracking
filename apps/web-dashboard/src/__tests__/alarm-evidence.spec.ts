import { describe, expect, it, vi } from 'vitest';

import { fromMdvrBcdTime, parseMdvrPhotoAck, toMdvrBcdTime } from '@/api/video.api';
import {
  type AlarmEventMediaHint,
  type AlarmMediaResource,
  alarmEventMediaHint,
  alarmEventPhotoName,
  alarmEventVideoWindow,
  alarmEvidenceWindow,
  deviceClockCandidates,
  hasAlarmCoordinates,
  isAlarmEventMedia,
  isDmsAlarm,
  matchEventPhotoName,
  mdvrChannelsForVehicle,
  parseMdvrEventPhotoName,
  pickAlarmRecording,
  selectAlarmEventClips,
} from '@/lib/alarm-evidence';
import type { CameraChannel } from '@/types/video.types';

describe('parseMdvrEventPhotoName', () => {
  it('reads timestamp and channel from a Meitrack DMS snapshot name', () => {
    const parsed = parseMdvrEventPhotoName('240823120009_CH2_E126S8_0.jpg');
    expect(parsed).not.toBeNull();
    expect(parsed?.channel).toBe(2);
    expect(parsed?.eventCode).toBe(126);
    expect(parsed?.subEventCode).toBe(8);
    expect(parsed?.bcdTime).toBe('240823120009');
    expect(parsed?.capturedAtMs).toBe(fromMdvrBcdTime('240823120009'));
  });

  it('reads channel from an MD300 name that has no E/S tag', () => {
    const parsed = parseMdvrEventPhotoName('20261018121349_CH1_daa.jpg');
    expect(parsed?.channel).toBe(1);
    expect(parsed?.bcdTime).toBe('261018121349');
    expect(parsed?.eventCode).toBe(0);
    expect(parsed?.capturedAtMs).toBe(Date.parse('2026-10-18T12:13:49.000Z'));
  });
});

describe('parseMdvrPhotoAck', () => {
  it('decodes the D00 JPEG payload', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const parsed = parseMdvrPhotoAck(
      JSON.stringify({ filename: 'a.jpg', photoBase64: btoa(String.fromCharCode(...bytes)) }),
    );
    expect(parsed?.filename).toBe('a.jpg');
    expect([...parsed!.bytes]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });
});

describe('hasAlarmCoordinates', () => {
  it('rejects the 0,0 placeholder', () => {
    expect(hasAlarmCoordinates({ lat: 0, lng: 0 })).toBe(false);
    expect(hasAlarmCoordinates({ lat: 35.72, lng: 51.39 })).toBe(true);
  });
});

describe('alarmEventVideoWindow', () => {
  it('uses raisedAt when the photo filename clock is a different day', () => {
    const photo = parseMdvrEventPhotoName('240823120005_CH2_E126S128_0.jpg');
    const raised = '2026-09-06T19:30:00.000Z';
    const win = alarmEventVideoWindow(photo, raised);
    const raisedMs = Date.parse(raised);
    expect(win).not.toBeNull();
    expect(win!.fromMs).toBe(raisedMs - 60_000);
    expect(win!.toMs).toBe(raisedMs + 3 * 60 * 1000);
  });

  it('keeps the photo timestamp when it is close to the alarm', () => {
    const raised = new Date(Date.UTC(2026, 8, 5, 12, 0, 9));
    const photo = parseMdvrEventPhotoName('260905120009_CH2_E126S8_0.jpg');
    const win = alarmEventVideoWindow(photo, raised.toISOString());
    expect(win).not.toBeNull();
    expect(photo).not.toBeNull();
    expect(win!.fromMs).toBe(photo!.capturedAtMs - 60_000);
  });

  it('asks AB4 for the device clock on the JPEG, not the operator timezone', () => {
    const raised = '2026-10-18T12:13:49.000Z';
    const photo = parseMdvrEventPhotoName('20261018121349_CH1_daa.jpg');
    const win = alarmEventVideoWindow(photo, raised);
    expect(win).not.toBeNull();
    expect(toMdvrBcdTime(win!.fromMs)).toBe('261018121249');
    expect(toMdvrBcdTime(win!.toMs)).toBe('261018121649');
    expect(toMdvrBcdTime(Date.parse(raised) - 5_000)).toBe('261018121344');
    expect(toMdvrBcdTime(Date.parse(raised) + 10_000)).toBe('261018121359');
  });
});

describe('alarmEvidenceWindow', () => {
  it('opens five minutes before and after the alarm', () => {
    const raised = '2026-09-05T12:00:00.000Z';
    const win = alarmEvidenceWindow(raised);
    expect(win).not.toBeNull();
    expect(win!.toMs - win!.fromMs).toBe(10 * 60 * 1000);
    expect(new Date(win!.fromMs).toISOString()).toBe('2026-09-05T11:55:00.000Z');
    expect(new Date(win!.toMs).toISOString()).toBe('2026-09-05T12:05:00.000Z');
  });
});

describe('isDmsAlarm', () => {
  it('treats catalog dms and device DMS codes as DMS', () => {
    expect(isDmsAlarm({ type: 'dms', code: undefined, rawType: undefined })).toBe(true);
    expect(isDmsAlarm({ type: 'other', code: 'DMS_EYES_CLOSED', rawType: 'DMS_EYES_CLOSED' })).toBe(
      true,
    );
    expect(isDmsAlarm({ type: 'overspeed', code: undefined, rawType: 'overspeed' })).toBe(false);
    expect(
      isDmsAlarm({
        type: 'other',
        code: undefined,
        rawType: 'device_alarm',
        sourceEvents: [
          {
            id: 'e1',
            type: 'device.alarm.DMS_SMOKING.v1',
            ts: '2026-09-05T12:00:00.000Z',
            detail: '{"photoName":"240823120009_CH2_E126S8_0.jpg"}',
          },
        ],
      }),
    ).toBe(true);
  });
});

describe('alarmEventPhotoName', () => {
  it('reads photoName from the device alarm JSON', () => {
    expect(alarmEventPhotoName('{"photoName":"IMG001.jpg","dmsDetail":"Eyes closed"}')).toBe(
      'IMG001.jpg',
    );
    expect(alarmEventPhotoName('{"speedKph":128}')).toBeUndefined();
  });

  it('reads photoName from a later detection bump', () => {
    expect(
      alarmEventPhotoName('{"occurrenceCount":2,"lastDetection":{"photoName":"IMG009.jpg"}}'),
    ).toBe('IMG009.jpg');
  });
});

describe('alarmEventMediaHint', () => {
  it('pulls photoName, event 126, and subtype from detail + source events', () => {
    const alarm = {
      type: 'dms' as const,
      code: 'DMS_EYES_CLOSED',
      rawType: 'DMS_EYES_CLOSED',
      detail: '{"deviceAlarm":true,"alarmCode":"DMS_EYES_CLOSED"}',
      sourceEvents: [
        {
          id: 'e1',
          type: 'device.alarm.DMS_EYES_CLOSED.v1',
          ts: '2026-09-05T12:00:00.000Z',
          detail: '{"source":"126","dmsAlarmType":1,"photoName":"E126S1.jpg"}',
        },
      ],
    };
    expect(alarmEventMediaHint(alarm)).toEqual({
      photoName: 'E126S1.jpg',
      eventCode: 126,
      subEventCode: 1,
    });
  });

  it('repairs a jpeg name that lost its last letter', () => {
    const alarm = {
      type: 'dms' as const,
      code: 'DMS_PHONE_CALL',
      rawType: undefined,
      detail: '{"photoName":"20261018124405_CH1_dca.jp"}',
      sourceEvents: [
        {
          id: 'e1',
          type: 'device.alarm.DMS_PHONE_CALL.v1',
          ts: '2026-10-18T12:44:05.000Z',
          detail: '{"photoName":"20261018124405_CH1_dca.jpg"}',
        },
      ],
    };
    expect(alarmEventMediaHint(alarm).photoName).toBe('20261018124405_CH1_dca.jpg');
  });

  it('defaults DMS eventCode to 126 when the packet omitted it', () => {
    const alarm = {
      type: 'dms' as const,
      code: 'DMS_YAWNING',
      rawType: undefined,
      detail: '{}',
      sourceEvents: [],
    };
    expect(alarmEventMediaHint(alarm).eventCode).toBe(126);
  });
});

describe('isAlarmEventMedia', () => {
  const raised = new Date(2026, 8, 5, 12, 0, 0).getTime();
  const hint: AlarmEventMediaHint = { eventCode: 126, subEventCode: 1 };

  function file(
    partial: Partial<AlarmMediaResource> & Pick<AlarmMediaResource, 'startTime'>,
  ): AlarmMediaResource {
    return {
      endTime: partial.endTime ?? partial.startTime,
      avType: 3,
      eventCode: 0,
      subEventCode: 0,
      ...partial,
    };
  }

  it('keeps DMS event 126 files that match the subtype', () => {
    const clip = file({
      startTime: toMdvrBcdTime(raised - 2_000),
      endTime: toMdvrBcdTime(raised + 8_000),
      eventCode: 126,
      subEventCode: 1,
    });
    expect(isAlarmEventMedia(clip, hint, raised)).toBe(true);
  });

  it('drops files tagged for a different DMS subtype', () => {
    const clip = file({
      startTime: toMdvrBcdTime(raised),
      eventCode: 126,
      subEventCode: 8,
    });
    expect(isAlarmEventMedia(clip, hint, raised)).toBe(false);
  });

  it('keeps a snapshot taken at the alarm time even without an event code', () => {
    const photo = file({
      startTime: toMdvrBcdTime(raised + 1_000),
      avType: 4,
    });
    expect(isAlarmEventMedia(photo, hint, raised)).toBe(true);
  });

  it('rejects long continuous recording that merely overlaps the window', () => {
    const continuous = file({
      startTime: toMdvrBcdTime(raised - 4 * 60 * 1000),
      endTime: toMdvrBcdTime(raised + 4 * 60 * 1000),
    });
    expect(isAlarmEventMedia(continuous, hint, raised)).toBe(false);
  });

  it('keeps a short event clip that overlaps the alarm without an event code', () => {
    const clip = file({
      startTime: toMdvrBcdTime(raised - 5_000),
      endTime: toMdvrBcdTime(raised + 15_000),
    });
    expect(isAlarmEventMedia(clip, hint, raised)).toBe(true);
  });
});

describe('selectAlarmEventClips', () => {
  it('filters a mixed AB8 list down to event media', () => {
    const raised = new Date(2026, 8, 5, 12, 0, 0).getTime();
    const clips = [
      {
        id: 'event',
        resource: {
          startTime: toMdvrBcdTime(raised),
          endTime: toMdvrBcdTime(raised + 10_000),
          avType: 3,
          eventCode: 126,
          subEventCode: 1,
        },
      },
      {
        id: 'continuous',
        resource: {
          startTime: toMdvrBcdTime(raised - 4 * 60 * 1000),
          endTime: toMdvrBcdTime(raised + 4 * 60 * 1000),
          avType: 3,
          eventCode: 0,
          subEventCode: 0,
        },
      },
    ];
    expect(
      selectAlarmEventClips(clips, { eventCode: 126, subEventCode: 1 }, raised).map((c) => c.id),
    ).toEqual(['event']);
  });
});

describe('mdvrChannelsForVehicle', () => {
  it('keeps only MDVR cameras for that vehicle', () => {
    const channels = [
      {
        id: 'a',
        sourceId: 'veh-1',
        protocol: 'MEITRACK_MDVR',
        deviceId: 'dev-1',
        imei: '123',
      },
      {
        id: 'b',
        sourceId: 'veh-1',
        protocol: 'RTSP',
        deviceId: 'dev-1',
        imei: '123',
      },
      {
        id: 'c',
        sourceId: 'veh-2',
        protocol: 'MEITRACK_MDVR',
        deviceId: 'dev-2',
        imei: '456',
      },
    ] as CameraChannel[];
    expect(mdvrChannelsForVehicle(channels, 'veh-1').map((c) => c.id)).toEqual(['a']);
  });
});

describe('pickAlarmRecording', () => {
  const clip = (startTime: string, endTime: string, avType = 2) => ({
    resource: { startTime, endTime, avType },
  });
  // Alarm 2026-10-19 05:59:51 UTC (the D00 photo stamp in the field log).
  const raised = Date.UTC(2026, 9, 19, 5, 59, 51);

  it('picks the file that contains the alarm on the UTC clock', () => {
    const pick = pickAlarmRecording(
      [clip('261019055000', '261019055500'), clip('261019055500', '261019060500')],
      raised,
    );
    expect(pick?.clip.resource.startTime).toBe('261019055500');
    expect(pick?.fromMs).toBeLessThanOrEqual(raised);
    expect(pick?.toMs).toBeGreaterThan(raised);
  });

  it('finds a file indexed on the local clock (Iran, UTC+3:30) when the UTC window is FFF5', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-210);
    try {
      expect(deviceClockCandidates(raised)).toEqual([raised, raised + 210 * 60_000]);
      // The card lists the same moment as 09:29:51 local.
      const pick = pickAlarmRecording([clip('261019092500', '261019093500')], raised);
      expect(pick?.clip.resource.startTime).toBe('261019092500');
      expect(pick?.fromMs).toBeLessThanOrEqual(Date.UTC(2026, 9, 19, 9, 29, 51));
      expect(pick?.toMs).toBeGreaterThan(Date.UTC(2026, 9, 19, 9, 29, 51));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('ignores photos and files far from the alarm', () => {
    expect(
      pickAlarmRecording(
        [clip('261019055900', '261019060000', 4), clip('261019010000', '261019011000')],
        raised,
      ),
    ).toBeNull();
  });

  it('plays the start of the nearest file within 10 minutes', () => {
    const pick = pickAlarmRecording([clip('261019060500', '261019061500')], raised);
    expect(pick?.fromMs).toBe(Date.UTC(2026, 9, 19, 6, 5, 0));
    expect(pick?.toMs).toBe(Date.UTC(2026, 9, 19, 6, 6, 0));
  });
});

describe('matchEventPhotoName', () => {
  const wanted = '20261019055951_CH1_dca.jpg';

  it('prefers the exact basename (with a folder or other case)', () => {
    expect(matchEventPhotoName(['/sd/PIC/20261019055951_ch1_DCA.JPG', 'other.jpg'], wanted)).toBe(
      '/sd/PIC/20261019055951_ch1_DCA.JPG',
    );
  });

  it('falls back to the same stamp, then the closest stamp with the same tag', () => {
    expect(matchEventPhotoName(['20261019055951_CH1_x.jpg'], wanted)).toBe(
      '20261019055951_CH1_x.jpg',
    );
    expect(
      matchEventPhotoName(
        ['20261019055944_CH1_dca.jpg', '20261019055953_CH1_dca.jpg', '20261019055953_CH2_dca.jpg'],
        wanted,
      ),
    ).toBe('20261019055953_CH1_dca.jpg');
  });

  it('returns null when nothing on the card is that snapshot', () => {
    expect(matchEventPhotoName(['20261019070000_CH1_dca.jpg', 'snap1.jpg'], wanted)).toBeNull();
  });
});
