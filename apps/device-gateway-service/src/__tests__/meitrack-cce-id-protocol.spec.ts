/**
 * MEITRACK GPRS (CCE ID) Protocol V1.0 (2025-03-30).
 *
 * The frame below is the §2.1 "Source Data" sample copied byte for byte from
 * the PDF: 12 cached records, length 1064, checksum 20. The struct examples
 * come from the §1.1 parameter table.
 */
import { describe, expect, it } from '@jest/globals';
import type { RawPacket } from '../domain/raw-packet.js';
import { MeitrackAdapter } from '../infrastructure/adapters/meitrack/meitrack.adapter.js';
import type { CceSnapshot } from '../infrastructure/adapters/meitrack/meitrack.cce-snapshot.js';
import { decodeCceStatus } from '../infrastructure/adapters/meitrack/meitrack.cce-status.js';
import { buildCceCacheAck } from '../infrastructure/adapters/meitrack/meitrack.decode.js';
import { ByteReader, NEED_MORE } from '../infrastructure/transport/byte-reader.js';

const PDF_SAMPLE_FRAME = Buffer.from(
  [
    '242450313036342c3836313538353034303439343436382c4343452c190000000c0054001500050501060a0700140015',
    '0209080000091f010a07000b260016000017000019a2011a26054023000602d7875701034860cc0604debfb5240c8068',
    '00000de4a003001c0100000001490904010000000000000054001500050501060907001400150209080000091f010a09',
    '000b270016000017000019a2011a26054023000602d0875701034160cc0604e8bfb5240c806800000deea003001c0100',
    '000001490904010000000000000054001500050501060907001400150209080000091f010a0b000b2700160000170000',
    '19a2011a26054023000602cf875701033e60cc0604f2bfb5240c806800000df8a003001c010000000149090401000000',
    '0000000054001500050501060a07001400150209080000091f010a08000b270016000017000019a3011a260540230006',
    '02d4875701034360cc0604fcbfb5240c806800000d02a103001c01000000014909040100000000000000540015000505',
    '01060a07001400150209080000091f010a07000b250016000017000019a2011a26054023000602da875701033e60cc06',
    '0406c0b5240c806800000d0ba103001c0100000001490904010000000000000054001500050501060a07001400150209',
    '080000091f010a08000b240016000017000019a2011a26054023000602df875701032f60cc060410c0b5240c80680000',
    '0d15a103001c0100000001490904010000000000000054001500050501060907001400150209080000091f010a08000b',
    '220016000017000019a2011a26054023000602e9875701031460cc06041ac0b5240c806800000d1fa103001c01000000',
    '01490904010000000000000054001500050501060907001400150209080000091f010a08000b210016000017000019a2',
    '011a26054023000602ee875701030e60cc060424c0b5240c806800000d29a103001c0100000001490904010000000000',
    '000054001500050501060907001400150209080000091f010a08000b210016000017000019a2011a26054023000602e9',
    '875701031660cc06042ec0b5240c806800000d33a103001c010000000149090401000000000000005400150005050106',
    '0907001400150209080000091f010a09000b230016000017000019a2011a26054023000602e687570103ff5fcc060439',
    'c0b5240c806800000d3da103001c01000000014909040100000000000000540015000505010609070014001502090800',
    '00091f010a09000b230016000017000019a2011a26054023000602e887570103e75fcc060443c0b5240c806800000d46',
    'a103001c0100000001490904010000000000000054001500050501060a070014001502090800000917010a08000b2300',
    '16000017000019a2011a26054023000602e887570103d75fcc06044dc0b5240c806800000d50a103001c010000000149',
    '090401000000000000002a32300d0a',
  ].join(''),
  'hex',
);

const NOW = new Date('2026-10-18T10:00:00Z');

function decode(buf: Buffer) {
  const adapter = new MeitrackAdapter();
  const reader = new ByteReader();
  reader.append(buf);
  const raw = adapter.frame(reader, NOW);
  if (raw === NEED_MORE) throw new Error('frame incomplete');
  return adapter.decode(raw as RawPacket);
}

function param(id: number, value: number[]) {
  return { id, value: Buffer.from(value) };
}

describe('CCE ID protocol — §2 parsing instance', () => {
  const messages = decode(PDF_SAMPLE_FRAME);
  const positions = messages.filter((m) => m.type === 'POSITION');

  it('frames the sample (length 1064, checksum 20) and decodes all 12 records', () => {
    expect(PDF_SAMPLE_FRAME.subarray(0, 8).toString('ascii')).toBe('$$P1064,');
    expect(positions).toHaveLength(12);
    expect(messages.every((m) => m.serialOrImei === '861585040494468')).toBe(true);
  });

  it('matches the §2.4 walk-through of the first record', () => {
    const first = positions[0];
    if (!first?.position) throw new Error('expected a position');
    expect(first.position.latitude).toBeCloseTo(22.513623, 6);
    expect(first.position.longitude).toBeCloseTo(114.057288, 6);
    expect(first.position.speedKph).toBe(0);
    expect(first.position.headingDeg).toBe(287);
    expect(first.position.altitudeM).toBe(38);
    expect(first.position.satellites).toBe(10);
    // 615890910 s after 2000-01-01 (cached record → GPS time, not receive time).
    expect(first.position.timestamp.toISOString()).toBe(
      new Date(Date.UTC(2000, 0, 1) + 615890910 * 1000).toISOString(),
    );

    const cce = first.telemetry?.cce as CceSnapshot;
    expect(cce.event).toBe(35);
    expect(cce.status).toEqual({
      gpsValid: true,
      satellites: 10,
      gsmSignal: 0,
      outputs: 0,
      inputs: 2,
      speedKph: 0,
      headingDeg: 287,
      hdop: 0.7,
      altitudeM: 38,
      ad1V: 0,
      ad2V: 0,
      batteryV: 4.18,
      batteryPct: 98,
      externalPowerV: 13.18,
      gpsTime: new Date(Date.UTC(2000, 0, 1) + 615890910 * 1000).toISOString(),
      mileageM: 26752,
      runTimeS: 237796,
      systemFlag: 1,
      eep2Modified: true,
      cameras: { supported: 4, connected: [1] },
    });
  });

  it('confirms all 12 cached records with CFF (quantity in hex)', () => {
    const ack = buildCceCacheAck(PDF_SAMPLE_FRAME)?.toString('ascii') ?? '';
    expect(ack).toContain('861585040494468,CFF,C*');
    expect(ack.startsWith('@@P')).toBe(true);
  });
});

describe('CCE ID protocol — §1.1 parameter structs', () => {
  it('decodes the 0x0E base-station example', () => {
    const status = decodeCceStatus([
      param(0x0e, [0xcc, 0x01, 0x01, 0x00, 0x45, 0xa5, 0x8b, 0xd4, 0xe9, 0x01, 0xbb, 0xff]),
    ]);
    expect(status.baseStation).toEqual({
      mcc: 460,
      mnc: 1,
      lac: 42309,
      cellId: 32101515,
      rxLevelDbm: -69,
    });
  });

  it('builds the 0x28 picture name from the documented example', () => {
    const status = decodeCceStatus([param(0x28, [0xcb, 0x0f, 0x23, 0x19, 0x01, 0x1e, 0x0c, 0x00])]);
    expect(status.pictureName).toBe('130513024323_C1E01.jpg');
  });

  it('decodes temperature sensors 0x2A–0x31 (°C × 100, signed)', () => {
    const status = decodeCceStatus([
      param(0x2a, [0x01, 0x09, 0x1a]),
      param(0x31, [0x08, 0x9c, 0xff]),
    ]);
    expect(status.temperatures).toEqual([
      { slot: 1, sensor: 1, celsius: 66.65 },
      { slot: 8, sensor: 8, celsius: -1 },
    ]);
  });

  it('scales the 1/2/4-byte table examples', () => {
    const status = decodeCceStatus([
      param(0x07, [0x1c]),
      param(0x5b, [0x01]),
      param(0x0a, [0x13, 0x00]),
      param(0x0b, [0xfe, 0xff]),
      param(0x19, [0xa0, 0x01]),
      param(0x1a, [0x51, 0x05]),
      param(0x29, [0x7a, 0x0d]),
      param(0x25, [0xd7, 0x9d, 0xd1, 0x00]),
      param(0x42, [0x04, 0x00, 0x00, 0x00]),
      param(0xfe90, [0x01, 0x00]),
    ]);
    expect(status).toMatchObject({
      gsmSignal: 28,
      deadReckoning: true,
      hdop: 1.9,
      altitudeM: -2,
      // The PDF prose says 99 % for 4.16 V; its own formula gives 95 %.
      batteryV: 4.16,
      batteryPct: 95,
      // The PDF prose says 1366 for 0x51 0x05, which is 0x0551 = 1361.
      externalPowerV: 13.61,
      fuelPct: 34.5,
      rfid: 13737431,
      inputs: 4,
      geofence: 1,
    });
  });

  it('decodes 0x4B network info and 0xF824 speed samples', () => {
    const status = decodeCceStatus([
      param(0x4b, [0x01, 0x01, 0x04, ...Buffer.from('LTE1')]),
      param(0xf824, [0x03, 0x64, 0x00, 60, 45, 20]),
    ]);
    expect(status.network).toEqual({
      version: 1,
      type: 1,
      typeLabel: 'mobile',
      descriptor: 'LTE1',
    });
    expect(status.speedCurve).toEqual({ intervalMs: 100, speedsKph: [60, 45, 20] });
  });

  it('decodes TPMS records from 0xFEF2 and the 0xFEF3 extension', () => {
    // Trailer 1 tyre 2, sensor 0xABCDEF, 320 × 0.025 = 8 bar, 75 − 50 = 25 °C,
    // low battery + slow leak.
    const tyre = [0x22, 0xef, 0xcd, 0xab, 0x40, 0x01, 75, 0x82];
    const status = decodeCceStatus([
      param(0xfef2, [0x01, ...tyre]),
      param(0xfef3, [0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 50, 0x40]),
    ]);
    expect(status.tyres).toHaveLength(2);
    expect(status.tyres?.[0]).toEqual({
      axleGroup: 1,
      tyre: 2,
      sensorId: 'ABCDEF',
      pressureBar: 8,
      temperatureC: 25,
      lowBattery: true,
      signalLost: false,
      pressureHigh: false,
      pressureLow: false,
      temperatureHigh: false,
      alert: 'slow_leak',
    });
    expect(status.tyres?.[1]).toMatchObject({ axleGroup: 0, tyre: 1, signalLost: true });
  });

  it('decodes the 0xFE96 people counter (one sensor + totals)', () => {
    const dword = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
    const status = decodeCceStatus([
      param(0xfe96, [
        0x01,
        ...[0x01, 0x02, 0x01, ...dword(3), ...dword(1), ...dword(30), ...dword(10)],
        ...[...dword(3), ...dword(1), ...dword(30), ...dword(10), ...dword(20)],
      ]),
    ]);
    expect(status.peopleCounter).toEqual({
      version: 1,
      sensors: [
        {
          sensor: 1,
          door: 2,
          state: 1,
          boarded: 3,
          alighted: 1,
          totalBoarded: 30,
          totalAlighted: 10,
        },
      ],
      boarded: 3,
      alighted: 1,
      totalBoarded: 30,
      totalAlighted: 10,
      onBoard: 20,
    });
  });

  it('leaves absent IDs out instead of reporting zeros', () => {
    expect(decodeCceStatus([])).toEqual({});
  });
});
