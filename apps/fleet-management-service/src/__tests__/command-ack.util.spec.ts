import { describe, expect, it } from '@jest/globals';

import { isDeviceErrorResponse } from '../infrastructure/kafka/command-ack-consumer.js';

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
