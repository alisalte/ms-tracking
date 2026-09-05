import { describe, expect, it } from 'vitest';

import {
  alarmEventPhotoName,
  alarmEvidenceWindow,
  hasAlarmCoordinates,
  isDmsAlarm,
  mdvrChannelsForVehicle,
} from '@/lib/alarm-evidence';
import type { CameraChannel } from '@/types/video.types';

describe('hasAlarmCoordinates', () => {
  it('rejects the 0,0 placeholder', () => {
    expect(hasAlarmCoordinates({ lat: 0, lng: 0 })).toBe(false);
    expect(hasAlarmCoordinates({ lat: 35.72, lng: 51.39 })).toBe(true);
  });
});

describe('alarmEvidenceWindow', () => {
  it('opens five minutes before and after the alarm', () => {
    const raised = '2026-09-05T12:00:00.000Z';
    const win = alarmEvidenceWindow(raised);
    expect(win).not.toBeNull();
    expect(win?.toMs - win!.fromMs).toBe(10 * 60 * 1000);
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
  });
});

describe('alarmEventPhotoName', () => {
  it('reads photoName from the device alarm JSON', () => {
    expect(alarmEventPhotoName('{"photoName":"IMG001.jpg","dmsDetail":"Eyes closed"}')).toBe(
      'IMG001.jpg',
    );
    expect(alarmEventPhotoName('{"speedKph":128}')).toBeUndefined();
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
