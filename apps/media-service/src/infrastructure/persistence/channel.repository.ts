/**
 * Channel repository — `media.video_channels` CRUD (09 §5.1, §7.3).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import { type Page, toCursor } from '@fleetvision/shared-kernel';
import { VideoChannel } from '../../domain/video-channel.js';

const SCHEMA = 'media';
const TABLE = 'video_channels';

interface ChannelRow {
  channel_id: string;
  tenant_id: string;
  vehicle_id: string | null;
  site_id: string | null;
  device_id: string | null;
  label: string;
  logical_channel: number | null;
  protocol: string;
  codec: string;
  endpoint: string | null;
  status: string;
  ptz: boolean;
  capabilities: Record<string, unknown> | string;
  version: number;
  created_at: Date;
}

export class ChannelRepository {
  constructor(private readonly knex: Knex) {}

  public async create(input: {
    tenantId: string;
    vehicleId?: string | null;
    siteId?: string | null;
    deviceId?: string | null;
    label: string;
    logicalChannel?: number | null;
    protocol: string;
    codec: string;
    endpoint?: string | null;
    ptz?: boolean;
    capabilities?: Record<string, unknown>;
  }): Promise<VideoChannel> {
    return withTenantContext(this.knex, input.tenantId, async (trx) => {
      const [row] = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .insert({
          tenant_id: trx.raw('?::uuid', [input.tenantId]),
          vehicle_id: input.vehicleId ? trx.raw('?::uuid', [input.vehicleId]) : null,
          site_id: input.siteId ? trx.raw('?::uuid', [input.siteId]) : null,
          device_id: input.deviceId ? trx.raw('?::uuid', [input.deviceId]) : null,
          label: input.label,
          logical_channel: input.logicalChannel ?? null,
          protocol: input.protocol,
          codec: input.codec,
          endpoint: input.endpoint ?? null,
          status: 'REGISTERED',
          ptz: input.ptz ?? false,
          capabilities: JSON.stringify(input.capabilities ?? {}),
        })
        .returning('*');
      return toChannel(row as ChannelRow);
    });
  }

  public async findById(channelId: string, tenantId: string): Promise<VideoChannel | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('channel_id = ?::uuid', [channelId])
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .first();
      return row ? toChannel(row as ChannelRow) : null;
    });
  }

  public async listByTenant(tenantId: string): Promise<VideoChannel[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .whereNot('status', 'DECOMMISSIONED')
        .orderBy('created_at', 'desc');
      return (rows as ChannelRow[]).map(toChannel);
    });
  }

  /** Cursor-paginated tenant channel list (keyset on `(created_at DESC, channel_id)`). */
  public async listByTenantPage(
    tenantId: string,
    limit: number,
    cursor?: { createdAt: string; id: string },
  ): Promise<Page<VideoChannel>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      let query = trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .whereNot('status', 'DECOMMISSIONED');
      if (cursor) {
        query = query.where((q) =>
          q
            .where('created_at', '<', cursor.createdAt)
            .orWhere((q2) =>
              q2.where('created_at', '=', cursor.createdAt).andWhere('channel_id', '<', cursor.id),
            ),
        );
      }
      const rows = (await query
        .orderBy('created_at', 'desc')
        .orderBy('channel_id', 'desc')
        .limit(limit + 1)) as ChannelRow[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last
          ? toCursor('created_at', last.created_at.toISOString(), last.channel_id)
          : null;
      return { data: page.map(toChannel), nextCursor };
    });
  }

  public async listByVehicle(tenantId: string, vehicleId: string): Promise<VideoChannel[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .whereRaw('vehicle_id = ?::uuid', [vehicleId])
        .whereNot('status', 'DECOMMISSIONED')
        .orderBy('logical_channel', 'asc');
      return (rows as ChannelRow[]).map(toChannel);
    });
  }

  public async updateStatus(channelId: string, tenantId: string, status: string): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const updated = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('channel_id = ?::uuid', [channelId])
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .update({ status, updated_at: trx.fn.now() });
      return updated > 0;
    });
  }
}

function toChannel(row: ChannelRow): VideoChannel {
  return new VideoChannel({
    channelId: row.channel_id,
    tenantId: row.tenant_id,
    vehicleId: row.vehicle_id,
    siteId: row.site_id,
    deviceId: row.device_id,
    label: row.label,
    logicalChannel: row.logical_channel,
    protocol: row.protocol as VideoChannel['protocol'],
    codec: row.codec as VideoChannel['codec'],
    endpoint: row.endpoint,
    status: row.status as VideoChannel['status'],
    ptz: row.ptz,
    capabilities:
      typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities,
    version: row.version,
  });
}
