import { describe, expect, it } from '@jest/globals';
import {
  type DeviceStatusSignal,
  type PositionSignal,
  SignalBus,
} from '../application/signal-bus.js';
import { DeviceStatusRecord } from '../domain/device-status.js';
import { PositionEvent } from '../domain/position-event.js';

const NOW = new Date('2026-08-06T10:00:00Z');

describe('SignalBus (07 §11.3)', () => {
  it('delivers a position signal to a subscribed listener', () => {
    const bus = new SignalBus();
    const received: PositionSignal[] = [];
    bus.onPosition((s) => received.push(s));

    bus.emitPosition(
      new PositionEvent({
        messageId: 'm1',
        vehicleId: 'dev-1',
        tenantId: 't1',
        latitude: 22,
        longitude: 113,
        speedKph: 10,
        headingDeg: 0,
        altitudeM: null,
        satellites: null,
        ignitionOn: null,
        capturedAt: NOW,
        ingestedAt: NOW,
        protocolId: 'gt06',
        quality: 'VALID',
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.vehicleId).toBe('dev-1');
    expect(received[0]?.latitude).toBe(22);
    expect(received[0]?.quality).toBe('VALID');
    bus.close();
  });

  it('delivers a device-status signal', () => {
    const bus = new SignalBus();
    const received: DeviceStatusSignal[] = [];
    bus.onDeviceStatus((s) => received.push(s));

    bus.emitDeviceStatus(
      new DeviceStatusRecord({
        deviceId: 'dev-1',
        tenantId: 't1',
        state: 'ONLINE',
        protocolId: 'gt06',
        reason: null,
        lastSeenAt: NOW,
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.state).toBe('ONLINE');
    bus.close();
  });

  it('supports multiple listeners (pipeline + WS gateway)', () => {
    const bus = new SignalBus();
    let count = 0;
    bus.onPosition(() => {
      count++;
    });
    bus.onPosition(() => {
      count++;
    });
    bus.emitPosition(
      new PositionEvent({
        messageId: 'm1',
        vehicleId: 'v1',
        tenantId: 't1',
        latitude: 1,
        longitude: 2,
        speedKph: 0,
        headingDeg: 0,
        altitudeM: null,
        satellites: null,
        ignitionOn: null,
        capturedAt: NOW,
        ingestedAt: NOW,
        protocolId: '',
        quality: 'VALID',
      }),
    );
    expect(count).toBe(2);
    bus.close();
  });
});
