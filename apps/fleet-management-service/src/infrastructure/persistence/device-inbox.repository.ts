/**
 * Platform inbox for IMEIs that have connected but are not owned by a
 * customer tenant yet.
 */
import type { Knex } from '@fleetvision/persistence-knex';

export interface DeviceInboxRow {
  readonly imei: string;
  readonly protocol: string;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly seenCount: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly claimedTenantId: string | null;
  readonly claimedDeviceId: string | null;
  readonly claimedAt: Date | null;
}

interface InboxDbRow {
  imei: string;
  protocol: string;
  manufacturer: string | null;
  model: string | null;
  seen_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  claimed_tenant_id: string | null;
  claimed_device_id: string | null;
  claimed_at: Date | null;
}

export class DeviceInboxRepository {
  constructor(private readonly knex: Knex) {}

  public async record(input: {
    imei: string;
    protocol: string;
    manufacturer?: string | null;
    model?: string | null;
  }): Promise<DeviceInboxRow> {
    const existing = await this.findByImei(input.imei);
    if (!existing) {
      const [row] = await this.knex
        .withSchema('fleet')
        .from('device_inbox')
        .insert({
          imei: input.imei,
          protocol: input.protocol,
          manufacturer: input.manufacturer ?? null,
          model: input.model ?? null,
        })
        .returning('*');
      return toRow(row as InboxDbRow);
    }
    if (existing.claimedAt) return existing;
    const [row] = await this.knex
      .withSchema('fleet')
      .from('device_inbox')
      .where('imei', input.imei)
      .update({
        protocol: input.protocol,
        manufacturer: input.manufacturer ?? existing.manufacturer,
        model: input.model ?? existing.model,
        seen_count: existing.seenCount + 1,
        last_seen_at: this.knex.fn.now(),
      })
      .returning('*');
    return toRow(row as InboxDbRow);
  }

  public async findByImei(imei: string): Promise<DeviceInboxRow | null> {
    const row = (await this.knex
      .withSchema('fleet')
      .from('device_inbox')
      .where('imei', imei)
      .first()) as InboxDbRow | undefined;
    return row ? toRow(row) : null;
  }

  public async listUnclaimed(limit = 100): Promise<DeviceInboxRow[]> {
    const rows = (await this.knex
      .withSchema('fleet')
      .from('device_inbox')
      .whereNull('claimed_at')
      .orderBy('last_seen_at', 'desc')
      .limit(limit)) as InboxDbRow[];
    return rows.map(toRow);
  }

  public async markClaimed(imei: string, tenantId: string, deviceId: string): Promise<void> {
    const existing = await this.findByImei(imei);
    if (!existing) {
      await this.knex.withSchema('fleet').from('device_inbox').insert({
        imei,
        protocol: 'meitrack',
        claimed_tenant_id: tenantId,
        claimed_device_id: deviceId,
        claimed_at: this.knex.fn.now(),
      });
      return;
    }
    await this.knex.withSchema('fleet').from('device_inbox').where('imei', imei).update({
      claimed_tenant_id: tenantId,
      claimed_device_id: deviceId,
      claimed_at: this.knex.fn.now(),
    });
  }
}

function toRow(row: InboxDbRow): DeviceInboxRow {
  return {
    imei: row.imei,
    protocol: row.protocol,
    manufacturer: row.manufacturer,
    model: row.model,
    seenCount: Number(row.seen_count),
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
    claimedTenantId: row.claimed_tenant_id,
    claimedDeviceId: row.claimed_device_id,
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : null,
  };
}
