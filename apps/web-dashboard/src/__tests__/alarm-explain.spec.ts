import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import en from '@/i18n/locales/en/common.json';
import fa from '@/i18n/locales/fa/common.json';
import {
  type ExplainTopic,
  explainAlarm,
  explainNotification,
  explainTopic,
  urgencyLevel,
  urgencyText,
} from '@/lib/alarm-explain';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('explainTopic', () => {
  it('groups device codes into everyday topics', () => {
    expect(explainTopic('GPS_SIGNAL_LOST')).toBe('gpsLost');
    expect(explainTopic('EVENT_24')).toBe('gpsLost');
    expect(explainTopic('DMS_EYES_CLOSED')).toBe('fatigue');
    expect(explainTopic('DMS_LOOK_LEFT')).toBe('distraction');
    expect(explainTopic('ADAS_LDW_LEFT')).toBe('laneDeparture');
    expect(explainTopic('ADAS_HMW')).toBe('tooClose');
    expect(explainTopic('INPUT_2_INACTIVE')).toBe('ignitionOff');
    expect(explainTopic('geofence_exit')).toBe('geofenceExit');
    expect(explainTopic('VIDEO_LOSS_CH3')).toBe('videoLoss');
  });

  it('falls back to the catalog type, then to a generic explanation', () => {
    expect(explainTopic(undefined, 'overspeed')).toBe('overspeed');
    expect(explainTopic('EVENT_999', 'other')).toBe('generic');
    expect(explainTopic()).toBe('generic');
  });
});

describe('explanation copy', () => {
  const topics = Object.keys(
    (en as { alarms: { explain: Record<string, unknown> } }).alarms.explain,
  ).filter((k) => k !== 'whatTitle' && k !== 'actionTitle');

  it('has a what + action sentence for every topic in both languages', () => {
    const faExplain = (
      fa as { alarms: { explain: Record<string, { what?: string; action?: string }> } }
    ).alarms.explain;
    for (const topic of topics) {
      expect(faExplain[topic]?.what, topic).toBeTruthy();
      expect(faExplain[topic]?.action, topic).toBeTruthy();
    }
  });

  it('explains an alarm in plain Persian', async () => {
    await i18n.changeLanguage('fa');
    const t = i18n.t.bind(i18n);
    const e = explainAlarm(t, {
      type: 'other',
      code: 'GPS_SIGNAL_LOST',
      message: 'Device alarm GPS_SIGNAL_LOST',
    });
    expect(e.topic).toBe('gpsLost' satisfies ExplainTopic);
    expect(e.what).toMatch(/ماهواره/);
    expect(e.action).toMatch(/پوشش GPS/);
  });

  it('reads the device code from notification metadata', () => {
    const t = i18n.t.bind(i18n);
    const e = explainNotification(t, {
      eventType: 'device_alarm',
      metadata: { alarmCode: 'SOS' },
    });
    expect(e.topic).toBe('sos');
    expect(e.what).toMatch(/emergency/i);
  });

  it('turns severities into an urgency sentence', () => {
    const t = i18n.t.bind(i18n);
    expect(urgencyLevel('critical')).toBe('critical');
    expect(urgencyLevel('high')).toBe('major');
    expect(urgencyLevel('low')).toBe('info');
    expect(urgencyText(t, 'critical')).toMatch(/urgent/i);
  });
});
