import { describe, expect, it } from '@jest/globals';
import {
  type DriverPhotoOptions,
  DriverPhotoService,
} from '../application/driver-photo.service.js';
import {
  type FaceReference,
  cosineSimilarity,
  driverPhotoFileName,
  matchFace,
} from '../domain/driver-photo.js';
import type { FaceEmbedder } from '../infrastructure/face/face-client.js';
import { IgnitionEdgeTracker } from '../infrastructure/kafka/ignition-trigger-consumer.js';
import type { DriverPhotoJob } from '../infrastructure/persistence/driver-photo.repository.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DEVICE = '22222222-2222-2222-2222-222222222222';

function unit(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

describe('matchFace', () => {
  const opts = { threshold: 0.4, margin: 0.05 };
  const alice = unit([1, 0, 0]);
  const bob = unit([0, 1, 0]);
  const refs: FaceReference[] = [
    { driverId: 'alice', embedding: alice },
    { driverId: 'alice', embedding: unit([0.9, 0.1, 0]) },
    { driverId: 'bob', embedding: bob },
  ];

  it('files the photo under the clearly best driver', () => {
    const r = matchFace(unit([0.95, 0.05, 0.1]), refs, opts);
    expect(r.driverId).toBe('alice');
    expect(r.score).toBeGreaterThan(0.9);
  });

  it('uses the best photo of each driver, not the average', () => {
    const r = matchFace(unit([0.9, 0.1, 0]), refs, opts);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it('leaves the photo unassigned below the threshold', () => {
    const r = matchFace(unit([0, 0, 1]), refs, opts);
    expect(r.driverId).toBeNull();
    expect(r.bestDriverId).not.toBeNull();
  });

  it('leaves the photo unassigned when two drivers are too close', () => {
    const twoDrivers: FaceReference[] = [
      { driverId: 'alice', embedding: alice },
      { driverId: 'bob', embedding: bob },
    ];
    const r = matchFace(unit([1, 0.95, 0]), twoDrivers, opts);
    expect(r.score).toBeGreaterThan(opts.threshold);
    expect(r.driverId).toBeNull();
    expect(r.runnerUpScore).not.toBeNull();
  });

  it('returns nothing without references', () => {
    expect(matchFace(alice, [], opts)).toEqual({
      driverId: null,
      score: null,
      bestDriverId: null,
      runnerUpScore: null,
    });
  });

  it('ignores references of another embedding size', () => {
    const r = matchFace(alice, [{ driverId: 'x', embedding: [1, 0] }], opts);
    expect(r.driverId).toBeNull();
  });

  it('cosine similarity of identical vectors is 1', () => {
    expect(cosineSimilarity([3, 4], [3, 4])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('builds a short file name the unit accepts', () => {
    const name = driverPhotoFileName('0a1b2c3d-4e5f-6789-abcd-ef0123456789');
    expect(name).toBe('drv_0a1b2c3d4e5f6789.jpg');
    expect(name.length).toBeLessThanOrEqual(60);
  });
});

describe('IgnitionEdgeTracker', () => {
  it('fires only on an OFF → ON edge', () => {
    const t = new IgnitionEdgeTracker();
    expect(t.feed('d', true)).toBe(false); // first sighting only primes
    expect(t.feed('d', true)).toBe(false);
    expect(t.feed('d', false)).toBe(false);
    expect(t.feed('d', true)).toBe(true);
    expect(t.feed('d', true)).toBe(false);
  });

  it('ignores fixes without an ignition reading', () => {
    const t = new IgnitionEdgeTracker();
    t.feed('d', false);
    expect(t.feed('d', null)).toBe(false);
    expect(t.feed('d', true)).toBe(true);
  });

  it('tracks devices independently', () => {
    const t = new IgnitionEdgeTracker();
    t.feed('a', false);
    t.feed('b', true);
    expect(t.feed('b', true)).toBe(false);
    expect(t.feed('a', true)).toBe(true);
  });
});

// ---------------------------------------------------------------- service flow

type Patch = Record<string, unknown>;

function makeHarness(opts: { face?: FaceEmbedder | null; refs?: FaceReference[] } = {}) {
  const job: { current: DriverPhotoJob } = {
    current: {
      id: '0a1b2c3d-4e5f-6789-abcd-ef0123456789',
      tenantId: TENANT,
      deviceId: DEVICE,
      vehicleId: null,
      camera: 2,
      fileName: null,
      status: 'PENDING',
      attempts: 0,
      captureCommandId: null,
      downloadCommandId: null,
      faceStatus: null,
    },
  };
  const patches: Patch[] = [];
  const created: Array<{ code: string; params: unknown }> = [];
  const commandRows = new Map<string, Record<string, unknown>>();
  const autoMatches: Array<{ driverId: string; score: number }> = [];
  const requests: Array<Record<string, unknown>> = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  const photos = {
    claimDue: async () => [job.current],
    patch: async (_t: string, _id: string, p: Patch) => {
      patches.push(p);
      job.current = {
        ...job.current,
        ...(p.status ? { status: p.status as DriverPhotoJob['status'] } : {}),
        ...(p.attempts !== undefined ? { attempts: p.attempts as number } : {}),
        ...(p.captureCommandId !== undefined
          ? { captureCommandId: p.captureCommandId as string | null }
          : {}),
        ...(p.downloadCommandId !== undefined
          ? { downloadCommandId: p.downloadCommandId as string | null }
          : {}),
        ...(p.fileName ? { fileName: p.fileName as string } : {}),
        ...(p.faceStatus !== undefined
          ? { faceStatus: p.faceStatus as DriverPhotoJob['faceStatus'] }
          : {}),
      };
    },
    loadPhoto: async () => jpeg,
    references: async () => opts.refs ?? [],
    setAutoMatch: async (_t: string, _id: string, driverId: string, score: number) => {
      autoMatches.push({ driverId, score });
      return true;
    },
    setMatchHint: async () => undefined,
    vehicleOfDevice: async () => 'veh-1',
    request: async (input: Record<string, unknown>) => {
      requests.push(input);
      return 'new-photo';
    },
  };
  const devices = {
    findById: async () => ({ id: DEVICE, status: 'ACTIVE', protocol: 'meitrack' }),
  };
  const commandRepo = {
    findById: async (_t: string, id: string) => commandRows.get(id) ?? null,
  };
  let seq = 0;
  const commands = {
    create: async (
      _ctx: unknown,
      _device: string,
      input: { commandCode: string; params: unknown },
    ) => {
      seq += 1;
      const id = `cmd-${seq}`;
      created.push({ code: input.commandCode, params: input.params });
      commandRows.set(id, {
        id,
        status: 'QUEUED',
        response_text: null,
        error: null,
        acked_at: null,
      });
      return { id };
    },
  };
  const options: DriverPhotoOptions = {
    enabled: true,
    captureOnConnect: true,
    camera: 2,
    delaySeconds: 45,
    cooldownMinutes: 30,
    workerIntervalMs: 0,
    batchSize: 10,
    matchThreshold: 0.4,
    matchMargin: 0.05,
  };
  const service = new DriverPhotoService(
    photos as never,
    devices as never,
    commandRepo as never,
    commands as never,
    opts.face === undefined ? null : opts.face,
    options,
  );
  return { service, job, patches, created, commandRows, autoMatches, requests, jpeg };
}

describe('DriverPhotoService capture flow', () => {
  it('runs D03 → D00 → READY and stores the JPEG', async () => {
    const h = makeHarness();
    await h.service.tick();
    expect(h.created[0]).toEqual({
      code: 'D03',
      params: { camera: 2, imagename: 'drv_0a1b2c3d4e5f6789.jpg' },
    });
    expect(h.job.current.status).toBe('CAPTURING');

    // Still in flight → just waits.
    await h.service.tick();
    expect(h.created).toHaveLength(1);

    h.commandRows.set('cmd-1', {
      id: 'cmd-1',
      status: 'ACKED',
      response_text: 'D03,OK',
      acked_at: new Date(Date.now() - 10_000),
    });
    await h.service.tick();
    expect(h.created[1]).toEqual({
      code: 'D00',
      params: { filename: 'drv_0a1b2c3d4e5f6789.jpg' },
    });
    expect(h.job.current.status).toBe('DOWNLOADING');

    h.commandRows.set('cmd-2', {
      id: 'cmd-2',
      status: 'ACKED',
      response_text: JSON.stringify({ photoBase64: h.jpeg.toString('base64') }),
      acked_at: new Date(),
    });
    await h.service.tick();
    expect(h.job.current.status).toBe('READY');
    const ready = h.patches.find((p) => p.status === 'READY');
    expect(Buffer.isBuffer(ready?.photo)).toBe(true);
    expect(ready?.faceStatus).toBe('PENDING');
  });

  it('retries a failed capture, then gives up', async () => {
    const h = makeHarness();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await h.service.tick(); // D03 issued
      h.commandRows.set(`cmd-${attempt}`, {
        id: `cmd-${attempt}`,
        status: 'EXPIRED',
        error: 'TTL_EXPIRED',
        response_text: null,
        acked_at: null,
      });
      await h.service.tick(); // sees the failure
    }
    expect(h.job.current.status).toBe('FAILED');
    expect(h.job.current.attempts).toBe(3);
  });

  it('matches a found face against confirmed photos', async () => {
    const face: FaceEmbedder = { embed: async () => ({ score: 0.9, embedding: unit([1, 0]) }) };
    const h = makeHarness({
      face,
      refs: [
        { driverId: 'alice', embedding: unit([1, 0.05]) },
        { driverId: 'bob', embedding: unit([0, 1]) },
      ],
    });
    h.job.current = { ...h.job.current, status: 'READY', faceStatus: 'PENDING' };
    await h.service.tick();
    expect(h.patches.some((p) => p.faceStatus === 'FOUND')).toBe(true);
    expect(h.autoMatches).toEqual([{ driverId: 'alice', score: expect.any(Number) }]);
  });

  it('marks NO_FACE when face-service finds nobody', async () => {
    const h = makeHarness({ face: { embed: async () => null } });
    h.job.current = { ...h.job.current, status: 'READY', faceStatus: 'PENDING' };
    await h.service.tick();
    expect(h.job.current.faceStatus).toBe('NO_FACE');
    expect(h.autoMatches).toHaveLength(0);
  });

  it('keeps the photo and retries later when face-service is down', async () => {
    const h = makeHarness({
      face: {
        embed: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    });
    h.job.current = { ...h.job.current, status: 'READY', faceStatus: 'PENDING' };
    await h.service.tick();
    expect(h.job.current.status).toBe('READY');
    expect(h.job.current.faceStatus).toBe('PENDING');
  });

  it('queues ignition snapshots after the seating delay', async () => {
    const h = makeHarness();
    const before = Date.now();
    await h.service.requestCapture(TENANT, DEVICE, 'IGNITION');
    const req = h.requests[0] as { captureAfter: Date; vehicleId: string; camera: number };
    expect(req.vehicleId).toBe('veh-1');
    expect(req.camera).toBe(2);
    expect(req.captureAfter.getTime()).toBeGreaterThanOrEqual(before + 44_000);
  });
});
