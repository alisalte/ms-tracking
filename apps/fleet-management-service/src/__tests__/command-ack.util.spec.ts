import { describe, expect, it } from '@jest/globals';

import {
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
