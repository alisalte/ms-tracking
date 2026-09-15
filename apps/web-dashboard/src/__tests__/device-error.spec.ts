import { describe, expect, it } from 'vitest';

import { commandReply, describeDeviceError } from '@/lib/device-error';

describe('describeDeviceError', () => {
  it('returns null for an absent error', () => {
    expect(describeDeviceError(null)).toBeNull();
    expect(describeDeviceError(undefined)).toBeNull();
    expect(describeDeviceError('   ')).toBeNull();
  });

  it('names an FFFx refusal from the device and keeps the raw code', () => {
    // An MD300 answers `CD1,FFFE` to a DMS calibration it will not run.
    expect(describeDeviceError('DEVICE_ERROR:FFFE')).toEqual({
      key: 'rejected',
      code: 'FFFE',
      fromDevice: true,
    });
  });

  it('separates FFF5 (no recording) from a plain refusal', () => {
    expect(describeDeviceError('DEVICE_ERROR:FFF5')?.key).toBe('noFile');
  });

  it('maps textual device replies', () => {
    expect(describeDeviceError('DEVICE_ERROR:Error')?.key).toBe('deviceError');
    expect(describeDeviceError('DEVICE_ERROR:NOT SUPPORT')?.key).toBe('unsupported');
  });

  it('falls back to unknownDevice for an unrecognised device payload', () => {
    expect(describeDeviceError('DEVICE_ERROR:ZZ9')).toEqual({
      key: 'unknownDevice',
      code: 'ZZ9',
      fromDevice: true,
    });
  });

  it('maps dispatcher verdicts, which never reached the device', () => {
    expect(describeDeviceError('TTL_EXPIRED')).toEqual({
      key: 'noReply',
      code: 'TTL_EXPIRED',
      fromDevice: false,
    });
    expect(describeDeviceError('DEVICE_OFFLINE')?.key).toBe('offline');
    expect(describeDeviceError('DEVICE_NOT_AUTHENTICATED')?.key).toBe('notAuthenticated');
    expect(describeDeviceError('ENCODE_FAILED')?.key).toBe('encodeFailed');
    expect(describeDeviceError('ADAPTER_NOT_FOUND:meitrack')?.key).toBe('adapterMissing');
  });

  it('passes anything else through as unknown with the raw text', () => {
    expect(describeDeviceError('something odd')).toEqual({
      key: 'unknown',
      code: 'something odd',
      fromDevice: false,
    });
  });
});

describe('commandReply', () => {
  const t = (key: string) => key;

  it('names a failure and keeps the raw device reply as secondary text', () => {
    expect(commandReply(t, { responseText: 'CD1,FFFE', error: 'DEVICE_ERROR:FFFE' })).toEqual({
      text: 'deviceError.rejected',
      raw: 'CD1,FFFE',
      isError: true,
    });
  });

  it('falls back to the decoded code when there is no response text', () => {
    expect(commandReply(t, { responseText: null, error: 'TTL_EXPIRED' })).toEqual({
      text: 'deviceError.noReply',
      raw: 'TTL_EXPIRED',
      isError: true,
    });
  });

  it('leaves a successful reply verbatim — `AB2,OK` is already clear', () => {
    expect(commandReply(t, { responseText: 'AB2,OK', error: null })).toEqual({
      text: 'AB2,OK',
      raw: null,
      isError: false,
    });
  });

  it('shows a dash when the device said nothing and nothing failed', () => {
    expect(commandReply(t, { responseText: null, error: null }).text).toBe('—');
  });
});
