import { describe, expect, it, jest } from '@jest/globals';

import { EvidenceCaptureWorker } from '../application/evidence-capture.worker.js';
import { ftpPasswordFor } from '../application/ftp-photo-ingest.js';
import { FtpPhotoReceiver } from '../application/ftp-photo-receiver.js';
import type { FleetManagementConfig } from '../config/fleet-management.config.js';
import type { EvidenceJob } from '../infrastructure/persistence/evidence-capture.repository.js';

const IMEI = '867191086416053';
const SECRET = 'test-secret';

describe('FtpPhotoReceiver.ensureProvisioned', () => {
  const cfg = {
    FLEET_FTP_SECRET: SECRET,
    FLEET_FTP_PUBLIC_HOST: '62.60.166.71',
    FLEET_FTP_PUBLIC_PORT: 21,
    FLEET_EVIDENCE_PHOTO_MAX_EDGE: 0,
    FLEET_EVIDENCE_PHOTO_QUALITY: 50,
  } as unknown as FleetManagementConfig;
  const wanted = {
    mode: '1',
    username: IMEI,
    password: ftpPasswordFor(SECRET, IMEI),
    host: '62.60.166.71',
    port: '21',
    path: '/',
  };

  function build(acked: Record<string, unknown> | null) {
    const create = jest.fn(async () => ({ id: 'cmd-1' }));
    const latestAckedSetting = jest.fn(async () => (acked ? { params: acked } : null));
    const receiver = new FtpPhotoReceiver(
      cfg,
      '',
      { findById: async () => ({ imei: IMEI }) } as never,
      {} as never,
      { create } as never,
      { latestAckedSetting } as never,
    );
    return { receiver, create, latestAckedSetting };
  }

  it('sends B64 to a unit that never accepted one', async () => {
    const { receiver, create } = build(null);
    expect(await receiver.ensureProvisioned('ten-1', 'dev-1')).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'ten-1', actorType: 'SYSTEM' }),
      'dev-1',
      { commandCode: 'B64', params: wanted },
    );
  });

  it('re-sends when the accepted B64 turned the upload off or points elsewhere', async () => {
    expect(await build({ mode: '0', port: '21' }).receiver.ensureProvisioned('t', 'd')).toBe(true);
    expect(await build({ ...wanted, host: '10.0.0.1' }).receiver.ensureProvisioned('t', 'd')).toBe(
      true,
    );
  });

  it('leaves a unit that already uploads here alone', async () => {
    const { receiver, create } = build({ ...wanted });
    expect(await receiver.ensureProvisioned('ten-1', 'dev-1')).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('asks a unit at most once per retry window across reconnects', async () => {
    const { receiver, create, latestAckedSetting } = build(null);
    await receiver.ensureProvisioned('ten-1', 'dev-1');
    await receiver.ensureProvisioned('ten-1', 'dev-1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(latestAckedSetting).toHaveBeenCalledTimes(1);
  });
});

describe('EvidenceCaptureWorker clip frame', () => {
  const job = (over: Partial<EvidenceJob> = {}): EvidenceJob => ({
    id: 'ev-1',
    tenantId: 'ten-1',
    alertId: 'al-1',
    deviceId: 'dev-1',
    photoName: null,
    status: 'PHOTO_MISSING',
    videoStatus: 'FETCHING',
    videoChannel: 2,
    videoWindowFrom: new Date('2026-11-08T18:31:02Z'),
    videoWindowTo: new Date('2026-11-08T18:31:17Z'),
    ...over,
  });

  function build(rows: EvidenceJob[], frameOn: (url: string, call: number) => boolean) {
    let calls = 0;
    const grabbed: string[] = [];
    const evidence = {
      claimPending: jest.fn(async () => []),
      claimVideoPending: jest.fn(async () => rows),
      markVideoFetching: jest.fn(async () => undefined),
      markVideoFailed: jest.fn(async () => undefined),
      releaseVideo: jest.fn(async () => undefined),
      markClipFrame: jest.fn(async () => true),
    };
    const create = jest.fn(async () => ({ id: `cmd-${create.mock.calls.length}` }));
    const worker = new EvidenceCaptureWorker({
      evidence: evidence as never,
      commands: { create } as never,
      intervalMs: 0,
      batchSize: 5,
      sleep: async () => undefined,
      clipFrames: {
        frames: {
          grab: async (url: string) => {
            grabbed.push(url);
            calls += 1;
            return frameOn(url, calls) ? Buffer.from('frame') : null;
          },
        },
        devices: { findById: async () => ({ imei: IMEI }) } as never,
        rtspBaseUrl: 'rtsp://mediamtx:8554/',
        rtmpPath: 'live/md300',
        compression: { maxEdge: 0, quality: 50 },
      },
    });
    return { worker, evidence, create, grabbed };
  }

  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('stores a frame of the AB4 playback when the alarm has no photo', async () => {
    const { worker, evidence, create, grabbed } = build([job()], (_u, call) => call >= 3);
    await worker.tick();
    await settle();
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      'dev-1',
      expect.objectContaining({ commandCode: 'AB4' }),
    );
    expect(grabbed[0]).toBe('rtsp://mediamtx:8554/live/md300_6053_2/pb_web');
    expect(grabbed[1]).toBe('rtsp://mediamtx:8554/live/md300_6053_2/pb');
    expect(evidence.markClipFrame).toHaveBeenCalledTimes(1);
    expect(evidence.markClipFrame).toHaveBeenCalledWith('ten-1', 'ev-1', expect.any(Buffer));
  });

  it('does not grab a frame when the unit snapshot is already stored', async () => {
    const { worker, evidence, grabbed } = build([job({ status: 'PHOTO_READY' })], () => true);
    await worker.tick();
    await settle();
    expect(grabbed).toHaveLength(0);
    expect(evidence.markClipFrame).not.toHaveBeenCalled();
  });

  it('plays one clip per unit at a time and puts the other alarm back', async () => {
    const rows = [job(), job({ id: 'ev-2', alertId: 'al-2' })];
    const { worker, evidence, create } = build(rows, () => false);
    await worker.tick();
    expect(create).toHaveBeenCalledTimes(1);
    expect(evidence.releaseVideo).toHaveBeenCalledWith('ten-1', 'ev-2');
  });
});
