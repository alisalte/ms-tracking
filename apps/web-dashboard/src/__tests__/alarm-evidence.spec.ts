import { describe, expect, it } from 'vitest';

import { fromMdvrBcdTime, parseMdvrPhotoAck, toMdvrBcdTime } from '@/api/video.api';
import {
  type AlarmEventMediaHint,
  type AlarmMediaResource,
  alarmEventMediaHint,
  alarmEventPhotoName,
  alarmEventVideoWindow,
  alarmEvidenceWindow,
  hasAlarmCoordinates,
  isAlarmEventMedia,
  isDmsAlarm,
  mdvrChannelsForVehicle,
  parseMdvrEventPhotoName,
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
    const raised = new Date(2026, 8, 5, 12, 0, 9);
    const bcd = `${String(raised.getFullYear()).slice(-2)}${String(raised.getMonth() + 1).padStart(2, '0')}${String(raised.getDate()).padStart(2, '0')}120009`;
    const photo = parseMdvrEventPhotoName(`${bcd}_CH2_E126S8_0.jpg`);
    const win = alarmEventVideoWindow(photo, raised.toISOString());
    expect(win).not.toBeNull();
    expect(photo).not.toBeNull();
    expect(win!.fromMs).toBe(photo!.capturedAtMs - 60_000);
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
