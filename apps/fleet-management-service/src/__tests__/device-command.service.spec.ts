import type { Knex } from '@fleetvision/persistence-knex';
import { describe, expect, it } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeviceCommandService } from '../application/device-command.service.js';
import type { ActorContext } from '../application/service-context.js';
import type { CommandRequestProducer } from '../infrastructure/kafka/command-request-producer.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import type {
  DeviceCommandRepository,
  DeviceCommandRow,
} from '../infrastructure/persistence/device-command.repository.js';
import type { DeviceRow } from '../infrastructure/persistence/device.repository.js';

const CTX: ActorContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  actorId: 'user-1',
  actorType: 'USER',
  requestId: null,
  ipAddress: null,
  userAgent: null,
};

const DEVICE_ID = '22222222-2222-2222-2222-222222222222';

function deviceRow(protocol = 'meitrack', status = 'ACTIVE'): DeviceRow {
  return {
    id: DEVICE_ID,
    tenant_id: CTX.tenantId,
    imei: '866854036516451',
    serial_number: null,
    manufacturer: 'Meitrack',
    model: 'MD522S',
    protocol: protocol as DeviceRow['protocol'],
    status: status as DeviceRow['status'],
    last_seen_at: null,
    connected_at: null,
    disconnected_at: null,
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function commandRow(overrides: Partial<DeviceCommandRow> = {}): DeviceCommandRow {
  return {
    id: 'cmd-1',
    tenant_id: CTX.tenantId,
    device_id: DEVICE_ID,
    command_code: 'A12',
    category: 'tracking',
    params: { interval: 6 },
    payload_text: 'A12,6',
    payload_hex: null,
    status: 'QUEUED',
    response_text: null,
    error: null,
    issued_by: 'user-1',
    issued_at: new Date(),
    sent_at: null,
    acked_at: null,
    expires_at: new Date(Date.now() + 120_000),
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/** Capture-based transaction stub — withTenantContext hands the same object. */
function makeDeps(overrides?: {
  device?: DeviceRow | null;
  deviceFor?: (id: string) => DeviceRow | null;
  producerError?: Error;
  published?: unknown[];
  mdvrPublicHost?: string;
}) {
  const published = overrides?.published ?? [];
  const created: DeviceCommandRow[] = [];
  const audits: unknown[] = [];

  const devices = {
    findById: async (_tenant: string, id: string) => {
      if (overrides?.deviceFor) return overrides.deviceFor(id);
      return overrides?.device === undefined ? deviceRow() : overrides.device;
    },
  };
  const commands = {
    create: async (
      _trx: unknown,
      _tenant: string,
      input: { commandCode: string; deviceId: string },
    ) => {
      const row = commandRow({ command_code: input.commandCode, device_id: input.deviceId });
      created.push(row);
      return row;
    },
    markFailed: async () => undefined,
  };
  const audit = { append: async (_trx: unknown, entry: unknown) => audits.push(entry) };
  const producer: CommandRequestProducer = {
    publish: async (event: unknown) => {
      if (overrides?.producerError) throw overrides.producerError;
      published.push(event);
    },
  } as unknown as CommandRequestProducer;

  // withTenantContext-compatible stub: knex.transaction(fn) hands a trx with
  // the SET LOCAL raw() call the real helper performs.
  const trx = { raw: async () => [] };
  const knex = {
    transaction: async (fn: (trx: unknown) => Promise<unknown>) => fn(trx),
  } as unknown as Knex;

  const service = new DeviceCommandService(
    knex,
    devices as never,
    commands as unknown as DeviceCommandRepository,
    audit as unknown as AuditRepository,
    producer,
    {
      defaultTtlSeconds: 120,
      sweepIntervalSeconds: 30,
      mdvrPublicHost: overrides?.mdvrPublicHost,
    },
  );
  return { service, published, created, audits };
}

describe('DeviceCommandService', () => {
  it('validates, persists, audits and publishes a catalog command', async () => {
    const { service, published, created, audits } = makeDeps();
    const record = await service.create(CTX, DEVICE_ID, {
      commandCode: 'a12',
      params: { interval: 6 },
    });

    expect(record.commandCode).toBe('A12'); // upper-cased
    expect(created[0]?.payload_text).toBe('A12,6');
    expect(published[0]).toMatchObject({
      deviceId: DEVICE_ID,
      tenantId: CTX.tenantId,
      commandCode: 'A12',
      payloadText: 'A12,6',
      payloadHex: null,
    });
    expect(audits[0]).toMatchObject({ action: 'device.command.issued' });
  });

  it('rejects unknown command codes', async () => {
    const { service } = makeDeps();
    await expect(service.create(CTX, DEVICE_ID, { commandCode: 'ZZZ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects non-meitrack devices', async () => {
    const { service } = makeDeps({ device: deviceRow('gt06') });
    await expect(
      service.create(CTX, DEVICE_ID, { commandCode: 'A12', params: { interval: 6 } }),
    ).rejects.toThrow(/does not support the Meitrack/);
  });

  it('rejects non-ACTIVE devices', async () => {
    const { service } = makeDeps({ device: deviceRow('meitrack', 'SUSPENDED') });
    await expect(
      service.create(CTX, DEVICE_ID, { commandCode: 'A12', params: { interval: 6 } }),
    ).rejects.toThrow(/SUSPENDED/);
  });

  it('404s when the device does not exist', async () => {
    const { service } = makeDeps({ device: null });
    await expect(service.create(CTX, DEVICE_ID, { commandCode: 'A12' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('surfaces catalog validation as a 400', async () => {
    const { service } = makeDeps();
    await expect(
      service.create(CTX, DEVICE_ID, { commandCode: 'B07', params: { speed: 999 } }),
    ).rejects.toThrow(/≤ 255/);
  });

  it('marks the command FAILED when the Kafka publish fails', async () => {
    const failed: string[] = [];
    const deps = {
      device: deviceRow(),
      producerError: new Error('broker down'),
    };
    const { service } = makeDepsWithMarkFailed(deps, failed);
    await expect(
      service.create(CTX, DEVICE_ID, { commandCode: 'A12', params: { interval: 6 } }),
    ).rejects.toThrow(/unavailable/i);
    expect(failed).toEqual(['cmd-1']);
  });

  it('queues the same command on every eligible device and isolates failures', async () => {
    const otherId = '33333333-3333-3333-3333-333333333333';
    const missingId = '44444444-4444-4444-4444-444444444444';
    const { service, published } = makeDeps({
      deviceFor: (id) => {
        if (id === DEVICE_ID) return deviceRow();
        if (id === otherId) return { ...deviceRow(), id: otherId, imei: '866854036516452' };
        if (id === missingId) return null;
        return { ...deviceRow('gt06'), id };
      },
    });

    const result = await service.createMany(CTX, {
      deviceIds: [DEVICE_ID, otherId, missingId, DEVICE_ID],
      commandCode: 'A12',
      params: { interval: 6 },
    });

    expect(result.queued.map((r) => r.deviceId).sort()).toEqual([DEVICE_ID, otherId].sort());
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.deviceId).toBe(missingId);
    expect(published).toHaveLength(2);
  });

  it('rejects an unknown bulk command code before touching devices', async () => {
    const { service, published } = makeDeps();
    await expect(
      service.createMany(CTX, { deviceIds: [DEVICE_ID], commandCode: 'ZZZ' }),
    ).rejects.toThrow(BadRequestException);
    expect(published).toHaveLength(0);
  });

  it('rewrites A9A loopback media host to MDVR_PUBLIC_HOST', async () => {
    const { service, published } = makeDeps({ mdvrPublicHost: '203.0.113.10' });
    await service.create(CTX, DEVICE_ID, {
      commandCode: 'A9A',
      params: {
        server: 'localhost',
        tcpPort: 6182,
        udpPort: 0,
        channel: 1,
        dataType: '1',
        streamType: '1',
      },
    });
    const event = published[0] as { payloadHex?: string };
    const hostHex = Buffer.from('203.0.113.10', 'ascii').toString('hex');
    expect(event?.payloadHex?.toLowerCase()).toContain(hostHex);
    expect(event?.payloadHex?.toLowerCase()).not.toContain(
      Buffer.from('localhost', 'ascii').toString('hex'),
    );
  });

  it('rewrites AB2 RTMP upload URL to MDVR_PUBLIC_HOST', async () => {
    const { service, published } = makeDeps({ mdvrPublicHost: '203.0.113.10' });
    await service.create(CTX, DEVICE_ID, {
      commandCode: 'AB2',
      params: {
        uploadUrl: 'rtmp://localhost:1935/live/866854036516451',
        channel: 1,
        dataType: '0',
        streamType: '0',
      },
    });
    const event = published[0] as { payloadHex?: string };
    const want = Buffer.from('rtmp://203.0.113.10:1935/live/md300/1', 'ascii').toString('hex');
    expect(event?.payloadHex?.toLowerCase()).toContain(want);
    expect(event?.payloadHex?.toLowerCase()).not.toContain(
      Buffer.from('localhost', 'ascii').toString('hex'),
    );
    expect(event?.payloadHex?.toLowerCase()).not.toContain(
      Buffer.from('live/866854036516451', 'ascii').toString('hex'),
    );
  });

  it('rewrites AB2 channel 2 to live/md300/2', async () => {
    const { service, published } = makeDeps({ mdvrPublicHost: '203.0.113.10' });
    await service.create(CTX, DEVICE_ID, {
      commandCode: 'AB2',
      params: {
        uploadUrl: 'rtmp://localhost:1935/live/md300',
        channel: 2,
        dataType: '0',
        streamType: '0',
      },
    });
    const event = published[0] as { payloadHex?: string };
    expect(event?.payloadHex?.toLowerCase()).toContain(
      Buffer.from('rtmp://203.0.113.10:1935/live/md300/2', 'ascii').toString('hex'),
    );
  });

  it('rewrites AB4 playback URL to live/md300/{channel}/pb', async () => {
    const { service, published } = makeDeps({ mdvrPublicHost: '203.0.113.10' });
    await service.create(CTX, DEVICE_ID, {
      commandCode: 'AB4',
      params: {
        url: 'rtmp://localhost:1935/live/md300',
        channel: 2,
        avType: '3',
        streamType: '0',
        capType: '0',
        startTime: '260904120000',
        endTime: '260904130000',
      },
    });
    const event = published[0] as { payloadHex?: string };
    expect(event?.payloadHex?.toLowerCase()).toContain(
      Buffer.from('rtmp://203.0.113.10:1935/live/md300/2/pb', 'ascii').toString('hex'),
    );
  });

  it('auto-sends AB2 to live/md300 when the GPRS session authenticates', async () => {
    const { service, published } = makeDeps({ mdvrPublicHost: '203.0.113.10' });
    await service.startMdvrLiveOnConnect(CTX.tenantId, DEVICE_ID);
    expect(published).toHaveLength(1);
    const event = published[0] as { commandCode?: string; payloadHex?: string };
    expect(event.commandCode).toBe('AB2');
    expect(event.payloadHex?.toLowerCase()).toContain(
      Buffer.from('rtmp://203.0.113.10:1935/live/md300/1', 'ascii').toString('hex'),
    );
    await service.startMdvrLiveOnConnect(CTX.tenantId, DEVICE_ID);
    expect(published).toHaveLength(1);
  });
});

/** Variant with a recording markFailed (publish-failure path). */
function makeDepsWithMarkFailed(
  overrides: { device: DeviceRow; producerError: Error },
  failed: string[],
) {
  const devices = { findById: async () => overrides.device };
  const commands = {
    create: async () => commandRow(),
    markFailed: async (_t: string, id: string) => {
      failed.push(id);
    },
  };
  const audit = { append: async () => undefined };
  const producer = {
    publish: async () => {
      throw overrides.producerError;
    },
  } as unknown as CommandRequestProducer;
  const trx = { raw: async () => [] };
  const knex = {
    transaction: async (fn: (trx: unknown) => Promise<unknown>) => fn(trx),
  } as unknown as Knex;
  const service = new DeviceCommandService(
    knex,
    devices as never,
    commands as unknown as DeviceCommandRepository,
    audit as unknown as AuditRepository,
    producer,
    { defaultTtlSeconds: 120, sweepIntervalSeconds: 30 },
  );
  return { service };
}
