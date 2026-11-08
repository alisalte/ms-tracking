import { describe, expect, it } from '@jest/globals';
import {
  type DriverPhotoOptions,
  DriverPhotoService,
  KEEP_IMAGES_PER_DRIVER,
} from '../application/driver-photo.service.js';
import { type FaceReference, cosineSimilarity, matchFace } from '../domain/driver-photo.js';
import type { FaceEmbedder, FrameGrabber } from '../infrastructure/face/face-client.js';
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

function makeHarness(
  opts: { face?: FaceEmbedder | null; refs?: FaceReference[]; liveStreams?: Set<string> } = {},
) {
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
  const prunes: Array<{ driverId: string; keep: number }> = [];
  const cleanups: Date[] = [];
  const requests: Array<Record<string, unknown>> = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  /** RTSP URLs face-service can currently read a frame from. */
  const liveStreams = opts.liveStreams ?? new Set<string>();
  const grabbed: string[] = [];
  const frames: FrameGrabber = {
    grab: async (url) => {
      grabbed.push(url);
      return liveStreams.has(url) ? jpeg : null;
    },
  };

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
    pruneDriverImages: async (_t: string, driverId: string, keep: number) => {
      prunes.push({ driverId, keep });
      return 0;
    },
    deleteFailedBefore: async (before: Date) => {
      cleanups.push(before);
      return 0;
    },
    vehicleOfDevice: async () => 'veh-1',
    request: async (input: Record<string, unknown>) => {
      requests.push(input);
      return 'new-photo';
    },
  };
  const devices = {
    findById: async () => ({
      id: DEVICE,
      imei: '867191086416848',
      status: 'ACTIVE',
      protocol: 'meitrack',
    }),
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
        command_code: input.commandCode,
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
    rtmpPath: 'live/md300',
    rtspBaseUrl: 'rtsp://mediamtx:8554',
  };
  const service = new DriverPhotoService(
    photos as never,
    devices as never,
    commandRepo as never,
    commands as never,
    opts.face === undefined ? null : opts.face,
    frames,
    options,
  );
  return {
    service,
    job,
    patches,
    created,
    commandRows,
    autoMatches,
    prunes,
    cleanups,
    requests,
    jpeg,
    liveStreams,
    grabbed,
  };
}

describe('DriverPhotoService capture flow', () => {
  const CAB_WEB = 'rtsp://mediamtx:8554/live/md300_6848_2_web';

  function ack(h: ReturnType<typeof makeHarness>, id: string, msAgo = 0): void {
    const row = h.commandRows.get(id) ?? {};
    h.commandRows.set(id, {
      ...row,
      status: 'ACKED',
      response_text: `${String(row.command_code)},OK`,
      acked_at: new Date(Date.now() - msAgo),
    });
  }

  it('starts the cabin stream, grabs a frame, then stops the stream', async () => {
    const h = makeHarness();
    await h.service.tick();
    expect(h.created[0]).toEqual({
      code: 'AB2',
      params: {
        channel: 2,
        dataType: '0',
        streamType: '0',
        uploadUrl: 'rtmp://127.0.0.1:1935/live/md300_6848_2',
      },
    });
    expect(h.job.current.status).toBe('CAPTURING');
    expect(h.job.current.fileName).toBe('live/md300_6848_2');

    // AB2 still in flight → just waits.
    await h.service.tick();
    expect(h.created).toHaveLength(1);

    // AB2,OK but the unit has not dialled RTMP yet → keeps polling.
    ack(h, 'cmd-1');
    await h.service.tick();
    expect(h.job.current.status).toBe('CAPTURING');
    expect(h.created).toHaveLength(1);

    h.liveStreams.add(CAB_WEB);
    await h.service.tick();
    expect(h.job.current.status).toBe('READY');
    expect(h.created[1]).toEqual({
      code: 'AB3',
      params: { channel: 2, control: '0', closeType: '0', switchType: '0' },
    });
    const ready = h.patches.find((p) => p.status === 'READY');
    expect(Buffer.isBuffer(ready?.photo)).toBe(true);
    expect(ready?.faceStatus).toBe('PENDING');
    expect(h.grabbed.every((u) => u === CAB_WEB)).toBe(true);
  });

  it('uses a stream an operator is already watching without AB2 or AB3', async () => {
    const h = makeHarness({ liveStreams: new Set([CAB_WEB]) });
    await h.service.tick();
    expect(h.job.current.status).toBe('READY');
    expect(h.created).toHaveLength(0);
  });

  it('stops the stream and retries when it never comes up', async () => {
    const h = makeHarness();
    await h.service.tick(); // AB2
    ack(h, 'cmd-1', 60_000);
    await h.service.tick();
    expect(h.created.map((c) => c.code)).toEqual(['AB2', 'AB3']);
    expect(h.job.current.status).toBe('PENDING');
    expect(h.job.current.attempts).toBe(1);
  });

  it('retries a failed capture, then gives up', async () => {
    const h = makeHarness();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await h.service.tick(); // AB2 issued
      h.commandRows.set(`cmd-${attempt}`, {
        id: `cmd-${attempt}`,
        command_code: 'AB2',
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

  it('restarts a job left on a D03 from the old flow', async () => {
    const h = makeHarness();
    h.commandRows.set('old', { id: 'old', command_code: 'D03', status: 'FAILED' });
    h.job.current = {
      ...h.job.current,
      status: 'CAPTURING',
      captureCommandId: 'old',
      fileName: 'drv_x.jpg',
    };
    await h.service.tick();
    expect(h.created[0]?.code).toBe('AB2');
    expect(h.job.current.attempts).toBe(0);
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
    expect(h.prunes).toEqual([{ driverId: 'alice', keep: KEEP_IMAGES_PER_DRIVER }]);
  });

  it('keeps every image when the face matches nobody', async () => {
    const face: FaceEmbedder = { embed: async () => ({ score: 0.9, embedding: unit([0, 1]) }) };
    const h = makeHarness({ face, refs: [{ driverId: 'alice', embedding: unit([1, 0]) }] });
    h.job.current = { ...h.job.current, status: 'READY', faceStatus: 'PENDING' };
    await h.service.tick();
    expect(h.autoMatches).toEqual([]);
    expect(h.prunes).toEqual([]);
  });

  it('deletes day-old failed captures at most once an hour', async () => {
    const h = makeHarness({});
    h.job.current = { ...h.job.current, status: 'FAILED' };
    await h.service.tick();
    await h.service.tick();
    expect(h.cleanups).toHaveLength(1);
    expect(Date.now() - (h.cleanups[0] as Date).getTime()).toBeGreaterThanOrEqual(
      24 * 3_600_000 - 1000,
    );
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
