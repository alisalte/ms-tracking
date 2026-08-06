/**
 * Channel repository — `media.video_channels` CRUD (09 §5.1, §7.3).
 */
import type { Knex } from '@fleetvision/persistence-knex';
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
    const [row] = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        tenant_id: this.knex.raw('?::uuid', [input.tenantId]),
        vehicle_id: input.vehicleId ? this.knex.raw('?::uuid', [input.vehicleId]) : null,
        site_id: input.siteId ? this.knex.raw('?::uuid', [input.siteId]) : null,
        device_id: input.deviceId ? this.knex.raw('?::uuid', [input.deviceId]) : null,
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
  }

  public async findById(channelId: string, tenantId: string): Promise<VideoChannel | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('channel_id = ?::uuid', [channelId])
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .first();
    return row ? toChannel(row as ChannelRow) : null;
  }

  public async listByTenant(tenantId: string): Promise<VideoChannel[]> {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereNot('status', 'DECOMMISSIONED')
      .orderBy('created_at', 'desc');
    return (rows as ChannelRow[]).map(toChannel);
  }

  public async listByVehicle(tenantId: string, vehicleId: string): Promise<VideoChannel[]> {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .whereNot('status', 'DECOMMISSIONED')
      .orderBy('logical_channel', 'asc');
    return (rows as ChannelRow[]).map(toChannel);
  }

  public async updateStatus(channelId: string, tenantId: string, status: string): Promise<boolean> {
    const updated = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('channel_id = ?::uuid', [channelId])
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .update({ status, updated_at: this.knex.fn.now() });
    return updated > 0;
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
    capabilities: typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities,
    version: row.version,
  });
}
