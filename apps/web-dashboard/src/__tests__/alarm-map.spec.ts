import { describe, expect, it } from 'vitest';

import { mapAlarm } from '@/api/alarm.api';
import { mapNotification } from '@/api/notification.api';

describe('mapAlarm', () => {
  it('reads Nest camelCase alarm payloads instead of inventing timestamps', () => {
    const alarm = mapAlarm({
      id: 'al-1',
      type: 'overspeed',
      severity: 'HIGH',
      status: 'OPEN',
      vehicleId: 'veh-42',
      lat: 35.721,
      lng: 51.389,
      message: 'Vehicle exceeded speed limit: 128.0 km/h (limit 80 km/h)',
      detail: { speedKph: 128, limit: 80 },
      sourceEvents: [
        {
          kind: 'position',
          speedKph: 128,
          capturedAt: '2026-09-05T10:00:00.000Z',
          sourceEventId: 'p1',
        },
      ],
      raisedAt: '2026-09-05T10:00:00.000Z',
      acknowledgedAt: null,
      resolvedAt: null,
    });

    expect(alarm.vehicleId).toBe('veh-42');
    expect(alarm.vehicleLabel).toBe('veh-42');
    expect(alarm.raisedAt).toBe('2026-09-05T10:00:00.000Z');
    expect(alarm.address).toBe('35.72100, 51.38900');
    expect(alarm.sourceEvents).toHaveLength(1);
    expect(alarm.sourceEvents[0]?.type).toBe('position');
    expect(alarm.sourceEvents[0]?.detail).toContain('128');
  });

  it('still accepts snake_case fixtures', () => {
    const alarm = mapAlarm({
      id: 'al-2',
      type: 'sos',
      severity: 'CRITICAL',
      status: 'ACKNOWLEDGED',
      vehicle_id: 'veh-9',
      vehicle_label: 'TRK-9',
      raised_at: '2026-09-01T08:00:00.000Z',
      acknowledged_at: '2026-09-01T08:05:00.000Z',
      source_events: [
        {
          id: 's1',
          type: 'tracking.sos.triggered.v1',
          ts: '2026-09-01T08:00:00.000Z',
          detail: 'SOS',
        },
      ],
      message: 'SOS / Panic button',
      detail: '',
      lat: 0,
      lng: 0,
    });

    expect(alarm.vehicleLabel).toBe('TRK-9');
    expect(alarm.status).toBe('acked');
    expect(alarm.ackedAt).toBe('2026-09-01T08:05:00.000Z');
    expect(alarm.sourceEvents[0]?.detail).toBe('SOS');
  });

  it('never puts a vehicle GUID in the label and resolves EVENT_n codes', () => {
    const guid = '140b552b-8c6a-411a-8ec1-d80ba2e7f1e1';
    const alarm = mapAlarm({
      id: 'al-3',
      type: 'other',
      severity: 'INFO',
      status: 'OPEN',
      vehicleId: guid,
      message: 'Device alarm EVENT_10',
      detail: {
        deviceAlarm: true,
        alarmCode: 'EVENT_10',
        deviceId: guid,
      },
      sourceEvents: [
        {
          type: 'device.alarm.EVENT_10.v1',
          ts: '2026-09-15T10:00:00.000Z',
          detail: JSON.stringify({
            deviceId: guid,
            imei: '867191086416152',
            source: '10',
          }),
        },
      ],
      raisedAt: '2026-09-15T10:00:00.000Z',
      lat: 0,
      lng: 0,
    });

    expect(alarm.code).toBe('INPUT_2_INACTIVE');
    expect(alarm.type).toBe('ignition');
    expect(alarm.vehicleLabel).toBe('867191086416152');
    expect(alarm.vehicleLabel).not.toContain(guid);
  });
});

describe('mapNotification', () => {
  it('reads camelCase createdAt from the notification-service', () => {
    const n = mapNotification({
      id: 'n1',
      title: 'Speeding: TRK-1',
      body: 'Vehicle exceeded the speed limit',
      severity: 'high',
      eventType: 'overspeed',
      vehicleId: 'veh-1',
      read: false,
      createdAt: '2026-09-05T09:30:00.000Z',
      link: '/alarms?id=al-1',
    });
    expect(n.createdAt).toBe('2026-09-05T09:30:00.000Z');
    expect(n.vehicleId).toBe('veh-1');
    expect(n.eventType).toBe('overspeed');
  });
});
