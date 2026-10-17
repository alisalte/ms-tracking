import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';

import { DeviceService } from '../application/device.service.js';
import type { ActorContext } from '../application/service-context.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = '99999999-9999-9999-9999-999999999999';
const DEVICE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const ctx: ActorContext = {
  tenantId: TENANT,
  actorId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  actorType: 'USER',
  requestId: 'req-1',
  ipAddress: null,
  userAgent: null,
};

describe('DeviceService.transferToTenant', () => {
  const query = {
    leftJoin: jest.fn().mockReturnThis(),
    whereRaw: jest.fn().mockReturnThis(),
    first: jest.fn(),
    delete: jest.fn(async () => 1),
    update: jest.fn(async () => 1),
  };
  const trx = Object.assign(
    jest.fn(() => query),
    {
      raw: jest.fn(() => 'raw'),
      fn: { now: () => 'now' },
    },
  );
  const knex = {
    from: jest.fn(() => query),
    transaction: jest.fn(async (cb: (tx: typeof trx) => Promise<void>) => cb(trx)),
  };
  const audit = { append: jest.fn(async () => undefined) };
  const inbox = { markClaimed: jest.fn(async () => undefined) };
  const invalidation = { invalidate: jest.fn() };
  let svc: DeviceService;

  beforeEach(() => {
    jest.clearAllMocks();
    query.leftJoin.mockReturnThis();
    query.whereRaw.mockReturnThis();
    svc = new DeviceService(
      knex as never,
      {} as never,
      audit as never,
      invalidation as never,
      null,
      null,
      null,
      inbox as never,
    );
  });

  it('moves a fleet-free device and does not copy its old positions', async () => {
    query.first.mockImplementation(async () => ({
      id: DEVICE_ID,
      tenant_id: OTHER,
      imei: '490154203237518',
      vehicle_id: null,
    }));

    await svc.transferToTenant(ctx, DEVICE_ID);

    expect(trx).toHaveBeenCalledWith('fleet.haul_members');
    expect(trx).toHaveBeenCalledWith('fleet.devices');
    expect(query.update).toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({
        action: 'device.transferred',
        before: { tenantId: OTHER },
        after: { tenantId: TENANT },
      }),
    );
    expect(inbox.markClaimed).toHaveBeenCalledWith('490154203237518', TENANT, DEVICE_ID);
    expect(invalidation.invalidate).toHaveBeenCalledWith(
      '490154203237518',
      'device.transferred',
      OTHER,
    );
    expect(invalidation.invalidate).toHaveBeenCalledWith(
      '490154203237518',
      'device.transferred',
      TENANT,
    );
  });

  it('refuses a device that is still on a fleet', async () => {
    query.first.mockImplementation(async () => ({
      id: DEVICE_ID,
      tenant_id: OTHER,
      imei: '490154203237518',
      vehicle_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    }));

    await expect(svc.transferToTenant(ctx, DEVICE_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(knex.transaction).not.toHaveBeenCalled();
  });
});
