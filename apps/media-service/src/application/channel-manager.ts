/**
 * Channel manager — VideoChannel CRUD + lifecycle (09 §5.1).
 */
import type { VideoChannel } from '../domain/video-channel.js';
import type { ChannelRepository } from '../infrastructure/persistence/channel.repository.js';

export interface ChannelManagerDeps {
  readonly repo: ChannelRepository;
}

export class ChannelManager {
  constructor(private readonly deps: ChannelManagerDeps) {}

  public async register(input: {
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
  }): Promise<VideoChannel> {
    return this.deps.repo.create(input);
  }

  public async findById(channelId: string, tenantId: string): Promise<VideoChannel | null> {
    return this.deps.repo.findById(channelId, tenantId);
  }

  public async listByTenant(tenantId: string): Promise<VideoChannel[]> {
    return this.deps.repo.listByTenant(tenantId);
  }

  public async listByVehicle(tenantId: string, vehicleId: string): Promise<VideoChannel[]> {
    return this.deps.repo.listByVehicle(tenantId, vehicleId);
  }

  public async markOnline(channelId: string, tenantId: string): Promise<boolean> {
    return this.deps.repo.updateStatus(channelId, tenantId, 'ONLINE');
  }

  public async markOffline(channelId: string, tenantId: string): Promise<boolean> {
    return this.deps.repo.updateStatus(channelId, tenantId, 'OFFLINE');
  }
}
