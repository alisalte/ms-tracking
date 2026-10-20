import { describe, expect, it } from '@jest/globals';

import {
  Ab8PacketCollector,
  isDeviceErrorResponse,
  shouldKeepPendingForListPayload,
} from '../infrastructure/kafka/command-ack-consumer.js';

describe('shouldKeepPendingForListPayload', () => {
  it('holds AB8/D01 on a bare OK so the file list can still ACK', () => {
    expect(shouldKeepPendingForListPayload('AB8', 'OK', false)).toBe(true);
    expect(shouldKeepPendingForListPayload('D01', 'ok', false)).toBe(true);
    expect(shouldKeepPendingForListPayload('AB8', 'OK', true)).toBe(false);
    expect(shouldKeepPendingForListPayload('AB2', 'OK', false)).toBe(false);
    expect(shouldKeepPendingForListPayload('AB8', 'FFF5', false)).toBe(false);
  });

  it('holds D00 on a bare OK until the photo arrives, but fails it on FFF5', () => {
    expect(shouldKeepPendingForListPayload('D00', 'OK', false)).toBe(true);
    expect(shouldKeepPendingForListPayload('D00', 'OK', true)).toBe(false);
    expect(shouldKeepPendingForListPayload('D00', 'FFF5', false)).toBe(false);
  });
});

describe('isDeviceErrorResponse', () => {
  it('treats OK and value-bearing readbacks as success', () => {
    expect(isDeviceErrorResponse('OK')).toBe(false);
    expect(isDeviceErrorResponse('10')).toBe(false);
    expect(isDeviceErrorResponse('1,178.131.31.231,6180,,,')).toBe(false);
  });

  it('treats explicit device failures as errors', () => {
    expect(isDeviceErrorResponse('Error')).toBe(true);
    expect(isDeviceErrorResponse('FFF5')).toBe(true);
    expect(isDeviceErrorResponse('NOT SUPPORT')).toBe(true);
  });
});

describe('Ab8PacketCollector', () => {
  const pkt = (curPack: number, allPack: number, files: number[]) => ({
    resources: files,
    allPack,
    curPack,
    allFileNum: 5,
  });

  it('waits for every packet and merges them in order', () => {
    const c = new Ab8PacketCollector();
    expect(c.add('cmd', pkt(2, 3, [3, 4]))).toBeNull();
    expect(c.add('cmd', pkt(1, 3, [1, 2]))).toBeNull();
    const merged = c.add('cmd', pkt(3, 3, [5]));
    expect(merged?.resources).toEqual([1, 2, 3, 4, 5]);
    expect(merged?.receivedPacks).toBe(3);
  });

  it('ignores a repeated packet and returns the partial list on take()', () => {
    const c = new Ab8PacketCollector();
    c.add('cmd', pkt(1, 3, [1, 2]));
    c.add('cmd', pkt(1, 3, [1, 2]));
    const partial = c.take('cmd');
    expect(partial?.resources).toEqual([1, 2]);
    expect(partial?.allPack).toBe(3);
    expect(c.take('cmd')).toBeNull();
  });
});
