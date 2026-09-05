import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import {
  extractDeviceCode,
  localizeAlarmDetail,
  localizeAlarmMessage,
  localizeEventType,
  localizeNotificationBody,
  localizeNotificationTitle,
  mapAlarmType,
} from '@/lib/alarm-copy';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('mapAlarmType', () => {
  it('maps rule types and device codes onto the catalog', () => {
    expect(mapAlarmType('geofence_enter')).toBe('geofence');
    expect(mapAlarmType('DEVICE_OFFLINE')).toBe('offline');
    expect(mapAlarmType('TOW')).toBe('tow');
    expect(mapAlarmType('DMS_EYES_CLOSED')).toBe('dms');
    expect(mapAlarmType('VIDEO_LOSS_CH5')).toBe('camera');
    expect(mapAlarmType('LOW_BATTERY')).toBe('battery');
    expect(mapAlarmType('prolonged_idle')).toBe('idle');
    expect(mapAlarmType('POWER_CUT')).toBe('power');
  });
});

describe('localizeAlarmMessage', () => {
  it('translates Device alarm SOS in Persian', async () => {
    await i18n.changeLanguage('fa');
    const text = localizeAlarmMessage(i18n.t.bind(i18n), {
      type: 'sos',
      message: 'Device alarm SOS',
      detail: '',
    });
    expect(text).toMatch(/اضطراری|SOS/);
  });

  it('translates overspeed evaluator copy', async () => {
    await i18n.changeLanguage('fa');
    const text = localizeAlarmMessage(i18n.t.bind(i18n), {
      type: 'overspeed',
      message: 'Vehicle exceeded speed limit: 82.0 km/h (limit 80 km/h)',
      detail: '',
    });
    expect(text).toContain('82');
    expect(text).toContain('کیلومتر');
    expect(text).not.toMatch(/Vehicle exceeded/i);
  });

  it('localizes DMS extra detail', async () => {
    await i18n.changeLanguage('fa');
    const text = localizeAlarmMessage(i18n.t.bind(i18n), {
      type: 'dms',
      message: 'Device alarm DMS_EYES_CLOSED — Eyes closed',
      detail: '',
    });
    expect(text).toContain('چشم');
    expect(text).not.toMatch(/Eyes closed/i);
  });

  it('translates persisted notification-template bodies', async () => {
    await i18n.changeLanguage('fa');
    const overspeed = localizeAlarmMessage(i18n.t.bind(i18n), {
      type: 'overspeed',
      message: 'Vehicle TRK-1 exceeded the speed limit (92 km/h in a 80 km/h zone).',
      detail: '',
    });
    expect(overspeed).toContain('92');
    expect(overspeed).toContain('کیلومتر');
    expect(overspeed).not.toMatch(/exceeded the speed limit/i);

    const idle = localizeNotificationBody(i18n.t.bind(i18n), {
      eventType: 'prolonged_idle',
      title: 'Prolonged idle: TRK-1',
      body: 'Vehicle TRK-1 has been idling for 22 min.',
    });
    expect(idle).toContain('کارکرد بیهوده');
    expect(idle).toContain('22 min');
  });
});

describe('localizeAlarmDetail', () => {
  it('renders overspeed JSON as a sentence, not raw keys', async () => {
    await i18n.changeLanguage('fa');
    const text = localizeAlarmDetail(i18n.t.bind(i18n), {
      type: 'overspeed',
      message: 'Vehicle exceeded speed limit: 128.0 km/h (limit 90 km/h)',
      detail: '{"speedKph":128,"limit":90}',
    });
    expect(text).toContain('128');
    expect(text).toContain('90');
    expect(text).not.toMatch(/speedKph/);
    expect(text).not.toMatch(/limit:/);
  });
});

describe('extractDeviceCode', () => {
  it('reads the Meitrack code from the English device headline', () => {
    expect(extractDeviceCode('Device alarm TOW')).toBe('TOW');
    expect(extractDeviceCode('Device alarm DMS_EYES_CLOSED — Eyes closed')).toBe('DMS_EYES_CLOSED');
  });
});

describe('localizeNotificationTitle', () => {
  it('rebuilds an English fallback title in the active locale', async () => {
    await i18n.changeLanguage('fa');
    const title = localizeNotificationTitle(i18n.t.bind(i18n), {
      eventType: 'sos',
      title: 'Alarm: sos',
    });
    expect(title).toMatch(/اضطراری|SOS/);
    expect(title).not.toMatch(/^Alarm:/);
  });

  it('keeps a vehicle suffix when present', async () => {
    await i18n.changeLanguage('en');
    const title = localizeNotificationTitle(i18n.t.bind(i18n), {
      eventType: 'overspeed',
      title: 'Speeding: Truck-42',
    });
    expect(title).toBe('Overspeed: Truck-42');
  });
});

describe('localizeEventType', () => {
  it('labels geofence_enter in FA', async () => {
    await i18n.changeLanguage('fa');
    expect(localizeEventType(i18n.t.bind(i18n), 'geofence_enter')).toContain('ورود');
  });
});
