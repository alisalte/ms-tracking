import { describe, expect, it } from '@jest/globals';
import {
  MEITRACK_COMMAND_CATALOG,
  buildPayload,
  getCommandDef,
  validateParams,
} from '../domain/device-command/meitrack-command-catalog.js';

/**
 * Catalog + payload-builder tests against the Meitrack MDVR GPRS Protocol
 * V2.0 examples (each case cites the protocol §).
 */
function build(code: string, params: Record<string, unknown>) {
  const def = getCommandDef(code);
  if (!def) throw new Error(`missing def ${code}`);
  return buildPayload(def, validateParams(def, params));
}

describe('meitrack command catalog', () => {
  it('covers the full TCP command surface with unique codes', () => {
    const codes = MEITRACK_COMMAND_CATALOG.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    // Spot-check one command from every documented family.
    for (const code of [
      'A10',
      'A11',
      'A12',
      'A13',
      'A14',
      'A15',
      'A16',
      'A17',
      'A21',
      'A23',
      'A25',
      'A70',
      'A71',
      'A72',
      'A73',
      'ABB',
      'AA3',
      'B05',
      'B06',
      'B07',
      'B08',
      'B10',
      'B11',
      'B22',
      'B26',
      'B31',
      'B34',
      'B35',
      'B36',
      'B64',
      'B91',
      'B99',
      'BB8',
      'C01',
      'C02',
      'C03',
      'C40',
      'C41',
      'C42',
      'C43',
      'C44',
      'C46',
      'C47',
      'C48',
      'C49',
      'C61',
      'C90',
      'CB8',
      'CFF',
      'D10',
      'D11',
      'D12',
      'D13',
      'D14',
      'D15',
      'D16',
      'D65',
      'D66',
      'D72',
      'D73',
      'D79',
      'DA0',
      'DA1',
      'DA2',
      'DA3',
      'DA4',
      'DA5',
      'A9A',
      'A9B',
      'A9C',
      'A9D',
      'A9E',
      'A9F',
      'AA0',
      'AA1',
      'AA4',
      'AB2',
      'AB3',
      'AB4',
      'AB5',
      'AB8',
      'E91',
      'F00',
      'F01',
      'F02',
      'F08',
      'F09',
      'F11',
      'RAW',
    ]) {
      if (!getCommandDef(code)) {
        throw new Error(`catalog must define ${code}`);
      }
    }
  });

  // --- tracking (§3.1–§3.8) --------------------------------------------------
  it('A10 emits a bare query', () => {
    expect(build('A10', {})).toEqual({ kind: 'text', text: 'A10' });
  });

  it('A11 formats the heartbeat interval (§3.2 example: A11,10)', () => {
    expect(build('A11', { minutes: 10 })).toEqual({ kind: 'text', text: 'A11,10' });
  });

  it('A12 formats the x10s interval (§3.3 example: A12,6)', () => {
    expect(build('A12', { interval: 6 })).toEqual({ kind: 'text', text: 'A12,6' });
  });

  it('A13 caps the angle at 359 (§3.4)', () => {
    expect(build('A13', { angle: 120 })).toEqual({ kind: 'text', text: 'A13,120' });
    const def = getCommandDef('A13')!;
    expect(() => validateParams(def, { angle: 360 })).toThrow(/must be ≤ 359/);
  });

  it('A14 formats distance meters (§3.5 example: A14,1000)', () => {
    expect(build('A14', { distance: 1000 })).toEqual({ kind: 'text', text: 'A14,1000' });
  });

  // --- network (§3.9–§3.11, §3.32) -------------------------------------------
  it('A21 pads empty APN fields with separators (§3.9 example)', () => {
    expect(build('A21', { mode: '1', host: '67.203.13.26', port: 8800 })).toEqual({
      kind: 'text',
      text: 'A21,1,67.203.13.26,8800,,,',
    });
  });

  it('A23 formats the standby server (§3.10 example)', () => {
    expect(build('A23', { host: '67.203.13.26', port: 8800 })).toEqual({
      kind: 'text',
      text: 'A23,67.203.13.26,8800',
    });
  });

  it('ABB reads back with no params and sets with all three (§3.32 example)', () => {
    expect(build('ABB', {})).toEqual({ kind: 'text', text: 'ABB' });
    expect(build('ABB', { enabled: '1', ssid: 'asd', password: '12345678' })).toEqual({
      kind: 'text',
      text: 'ABB,1,asd,12345678',
    });
  });

  // --- phone (§3.12–§3.14) -----------------------------------------------------
  it('A71 keeps empty phone slots as separators (§3.13)', () => {
    expect(build('A71', { phone1: '13811111111' })).toEqual({
      kind: 'text',
      text: 'A71,13811111111,,',
    });
  });

  it('A72 formats listen-in numbers (§3.14 example)', () => {
    expect(build('A72', { phone1: '13844444444', phone2: '13855555555' })).toEqual({
      kind: 'text',
      text: 'A72,13844444444,13855555555',
    });
  });

  it('B99 builds a GPRS GET request (§3.47 example)', () => {
    expect(build('B99', { target: '2', operation: '0' })).toEqual({
      kind: 'text',
      text: 'B99,2,0',
    });
  });

  // --- alerts (§3.35, §3.76, §3.60) -------------------------------------------
  it('B07 formats the speeding threshold (§3.35 example: B07,60)', () => {
    expect(build('B07', { speed: 60 })).toEqual({ kind: 'text', text: 'B07,60' });
  });

  it('D79 keeps the negative braking threshold (§3.76 example)', () => {
    expect(build('D79', { acceleration: 150, braking: -180 })).toEqual({
      kind: 'text',
      text: 'D79,150,-180',
    });
  });

  it('C49 formats fuel-theft window and percent (§3.60 example)', () => {
    expect(build('C49', { checkMinutes: 3, decreasePercent: 2 })).toEqual({
      kind: 'text',
      text: 'C49,3,2',
    });
  });

  // --- geofence (§3.33, §3.38) -------------------------------------------------
  it('B05 formats 6-decimal coordinates (§3.33 example)', () => {
    expect(
      build('B05', {
        fenceNumber: 1,
        latitude: 22.913191,
        longitude: 114.079882,
        radius: 1000,
        enterAlert: '0',
        exitAlert: '1',
      }),
    ).toEqual({ kind: 'text', text: 'B05,1,22.913191,114.079882,1000,0,1' });
  });

  it('B11 flattens polygon vertices and defaults both alerts (§3.38 example)', () => {
    expect(
      build('B11', {
        fenceNumber: 1,
        points: '22.526922,114.052695;22.526946,114.056232;22.523720,114.053521',
        enterAlert: '1',
        exitAlert: '1',
      }),
    ).toEqual({
      kind: 'text',
      text: 'B11,1,22.526922,114.052695,22.526946,114.056232,22.523720,114.053521,1,1',
    });
  });

  it('B11 with only a fence number deletes the fence (§3.38)', () => {
    expect(build('B11', { fenceNumber: 2 })).toEqual({ kind: 'text', text: 'B11,2' });
  });

  it('B11 rejects fewer than 3 vertices', () => {
    expect(() => build('B11', { fenceNumber: 1, points: '22.5,114.0;22.6,114.1' })).toThrow(
      /at least 3/,
    );
  });

  // --- device (§3.40, §3.75, §3.73) --------------------------------------------
  it('B26 emits only provided ports (§3.40 example)', () => {
    expect(build('B26', { port1: 1000, port2: 1000 })).toEqual({
      kind: 'text',
      text: 'B26,1:1000,2:1000',
    });
    expect(build('B26', {})).toEqual({ kind: 'text', text: 'B26' });
  });

  it('D73 sums to a split (§3.75 example)', () => {
    expect(build('D73', { gprsPercent: 50, logPercent: 50 })).toEqual({
      kind: 'text',
      text: 'D73,50,50',
    });
  });

  it('D66 pads maintenance points to eight (§3.73 example)', () => {
    expect(build('D66', { points: '8726,8816,8906,8996,9086,9176,9266,9356' })).toEqual({
      kind: 'text',
      text: 'D66,8726,8816,8906,8996,9086,9176,9266,9356',
    });
    expect(build('D65', { points: '5000' })).toEqual({
      kind: 'text',
      text: 'D65,5000,0,0,0,0,0,0,0',
    });
  });

  // --- outputs (§3.49, §3.74) ----------------------------------------------------
  it('C01 concatenates the five output states (§3.49 example: C01,20,10122)', () => {
    expect(
      build('C01', { speed: 20, out1: '1', out2: '0', out3: '1', out4: '2', out5: '2' }),
    ).toEqual({ kind: 'text', text: 'C01,20,10122' });
  });

  it('C01 defaults unspecified outputs to keep (2)', () => {
    expect(build('C01', { speed: 0, out1: '1' })).toEqual({
      kind: 'text',
      text: 'C01,0,12222',
    });
  });

  it('D72 formats output triggering (§3.74 example)', () => {
    expect(
      build('D72', { port: '1', time: 100, level: '0', dutyCycle: 0, pwmPeriod: 10000 }),
    ).toEqual({ kind: 'text', text: 'D72,1,100,0,0,10000' });
  });

  // --- rfid (§3.65–§3.71) --------------------------------------------------------
  it('D10 formats id lists (§3.65 example)', () => {
    expect(build('D10', { ids: '13737431,13737461' })).toEqual({
      kind: 'text',
      text: 'D10,13737431,13737461',
    });
  });

  // --- media binary structs (§4.2, §4.4, appendix) --------------------------------
  it('A9B builds the 4-byte control struct (§4.2 example: 01 01 00 00)', () => {
    expect(build('A9B', { channel: 1, control: '1', closeType: '0', switchType: '0' })).toEqual({
      kind: 'hex',
      hex: `4139422C${'01010000'.toUpperCase()}`,
    });
  });

  it('A9A length-prefixes the server and big-endian ports (§4.1 example)', () => {
    const out = build('A9A', {
      server: 'ssl.meiligao.org',
      tcpPort: 26997,
      udpPort: 0,
      channel: 1,
      dataType: '0',
      streamType: '1',
    });
    expect(out.kind).toBe('hex');
    if (out.kind !== 'hex') return;
    const body = Buffer.from(out.hex.slice(8), 'hex'); // after "A9A,"
    expect(body[0]).toBe(16); // ip_len = 16
    expect(body.subarray(1, 17).toString('ascii')).toBe('ssl.meiligao.org');
    expect(body.readUInt16BE(17)).toBe(26997); // tcp port
    expect(body.readUInt16BE(19)).toBe(0); // udp port
    expect(body[21]).toBe(1); // channel
    expect(body[22]).toBe(0); // data type
    expect(body[23]).toBe(1); // stream type
  });

  it('A9C BCD-encodes the time window (§4.3 example)', () => {
    const out = build('A9C', {
      channel: 1,
      startTime: '190724000000',
      endTime: '190724235959',
      avType: '0',
      streamType: '0',
      capType: '1',
      alarmCodes: '1',
    });
    expect(out.kind).toBe('hex');
    if (out.kind !== 'hex') return;
    const body = Buffer.from(out.hex.slice(8), 'hex');
    expect(body[0]).toBe(1); // channel
    expect([...body.subarray(1, 7)]).toEqual([0x19, 0x07, 0x24, 0, 0, 0]); // BCD start
    expect([...body.subarray(7, 13)]).toEqual([0x19, 0x07, 0x24, 0x23, 0x59, 0x59]); // BCD end
    expect(body.readUInt16LE(body.length - 2)).toBe(1); // one alarm code
  });

  it('AA0 prefixes the flag byte to the file name (§4.7 example)', () => {
    const out = build('AA0', { flag: '2', fileName: 'CH3_2020.avmsg' });
    expect(out.kind).toBe('hex');
    if (out.kind !== 'hex') return;
    const body = Buffer.from(out.hex.slice(8), 'hex');
    expect(body[0]).toBe(2);
    expect(body.subarray(1).toString('ascii')).toBe('CH3_2020.avmsg');
  });

  // --- system (§3.88, §3.84) --------------------------------------------------------
  it('F08 keeps blank slots for unset fields (§3.87 example)', () => {
    expect(build('F08', { mileage: 4825000 })).toEqual({
      kind: 'text',
      text: 'F08,,4825000',
    });
  });

  it('F00 formats module restart flags (§3.84)', () => {
    expect(build('F00', { gsm: '1', gps: '1' })).toEqual({ kind: 'text', text: 'F00,1,1' });
  });

  // --- custom ------------------------------------------------------------------------
  it('RAW passes through a well-formed body and rejects garbage', () => {
    expect(build('RAW', { text: 'A16,1' })).toEqual({ kind: 'text', text: 'A16,1' });
    expect(() => build('RAW', { text: 'do evil' })).toThrow(/must start with a command code/);
    const def = getCommandDef('RAW')!;
    expect(() => validateParams(def, { text: 'bad,code' })).not.toThrow(); // commas allowed by design
  });

  // --- validation guards ---------------------------------------------------------------
  it('rejects unknown params, missing required, and out-of-range values', () => {
    const def = getCommandDef('B07')!;
    expect(() => validateParams(def, { speed: 60, bogus: 1 })).toThrow(/Unknown parameter/);
    expect(() => validateParams(def, {})).toThrow(/required/);
    expect(() => validateParams(def, { speed: 300 })).toThrow(/≤ 255/);
    expect(() => validateParams(def, { speed: 'abc' })).toThrow(/number/);
  });

  it('rejects commas in non-list string params', () => {
    const def = getCommandDef('A21')!;
    expect(() => validateParams(def, { mode: '1', host: '1.2.3.4,5', port: 1 })).toThrow(
      /must not contain commas/,
    );
  });

  it('enforces the 1024-byte protocol limit', () => {
    expect(() =>
      build('C02', { mode: '0', phone: '1234567890', content: 'x'.repeat(141) }),
    ).toThrow(/140/);
  });
});
