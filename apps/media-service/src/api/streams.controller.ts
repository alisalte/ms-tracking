import {
  type AuthenticatedContext,
  CurrentTenant,
  CurrentUser,
  RequirePermissions,
} from '@fleetvision/auth';
/**
 * Streams + Channels REST API (09 §5; 10 §3.1).
 *
 *   POST   /streams              — open a stream session (returns sessionId + signalingToken + sdpOffer).
 *   POST   /streams/batch         — multi-channel batch open.
 *   DELETE /streams/:id           — close a session.
 *   GET    /channels              — list channels.
 *   GET    /channels/:id          — channel detail.
 *   POST   /channels              — register a channel.
 *   GET    /vehicles/:id/channels — list a vehicle's cameras (multi-channel).
 *
 * Sprint B: authentication enforced globally; reads require `media.read`,
 * stream/channel create+close require `media.write`. Tenant + userId are taken
 * from the verified JWT (INV-I02) — never from the request body. Closing a
 * session is tenant-scoped (WS7): a cross-tenant caller gets 404.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { ChannelManager } from '../application/channel-manager.js';
import type { StreamManager } from '../application/stream-manager.js';
import { CHANNEL_MANAGER, STREAM_MANAGER } from './tokens.js';

@Controller()
export class StreamsController {
  constructor(
    @Inject(CHANNEL_MANAGER) private readonly channels: ChannelManager,
    @Inject(STREAM_MANAGER) private readonly streams: StreamManager,
  ) {}

  // --- Stream sessions ---

  @Post('streams')
  @RequirePermissions('media.write')
  public async openStream(
    @CurrentUser() auth: AuthenticatedContext,
    @Body() body: Record<string, unknown>,
  ) {
    const tenantId = auth.tenantId;
    const channelId = String(body.channelId ?? '');
    if (!channelId) throw new HttpException('channelId required', HttpStatus.BAD_REQUEST);
    const channel = await this.channels.findById(channelId, tenantId);
    if (!channel) throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
    // userId comes from the verified principal, NOT the request body (WS7).
    return this.streams.openSession(channel, {
      userId: auth.authMethod === 'API_KEY' ? null : auth.userId,
      quality: body.quality ? String(body.quality) : 'auto',
      mode: body.mode ? String(body.mode) : 'LIVE',
    });
  }

  @Post('streams/batch')
  @RequirePermissions('media.write')
  public async openBatch(
    @CurrentUser() auth: AuthenticatedContext,
    @Body() body: Record<string, unknown>,
  ) {
    const tenantId = auth.tenantId;
    const channelIds = (body.channelIds as string[]) ?? [];
    if (channelIds.length === 0) {
      throw new HttpException('channelIds required', HttpStatus.BAD_REQUEST);
    }
    const results = await Promise.allSettled(
      channelIds.map(async (cid) => {
        const channel = await this.channels.findById(cid, tenantId);
        if (!channel) throw new Error(`Channel ${cid} not found`);
        return this.streams.openSession(channel, {
          userId: auth.authMethod === 'API_KEY' ? null : auth.userId,
          quality: body.quality ? String(body.quality) : 'auto',
        });
      }),
    );
    return {
      sessions: results.map((r, i) =>
        r.status === 'fulfilled'
          ? {
              channelId: channelIds[i],
              ok: true,
              sessionId: r.value.sessionId,
              signalingToken: r.value.signalingToken.token,
            }
          : {
              channelId: channelIds[i],
              ok: false,
              error: r.reason instanceof Error ? r.reason.message : 'failed',
            },
      ),
    };
  }

  @Delete('streams/:id')
  @RequirePermissions('media.write')
  public async closeStream(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const updated = await this.streams.closeSessionForTenant(id, tenantId);
    if (updated === 0) {
      // Cross-tenant or unknown — no existence oracle.
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }
    return { closed: true };
  }

  // --- Channels ---

  @Get('channels')
  @RequirePermissions('media.read')
  public async listChannels(
    @CurrentTenant() tenantId: string,
    @Query('vehicleId') vehicleId: string | undefined,
  ) {
    return vehicleId
      ? this.channels.listByVehicle(tenantId, vehicleId)
      : this.channels.listByTenant(tenantId);
  }

  @Get('channels/:id')
  @RequirePermissions('media.read')
  public async getChannel(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const ch = await this.channels.findById(id, tenantId);
    if (!ch) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return ch;
  }

  @Post('channels')
  @RequirePermissions('media.write')
  public async registerChannel(
    @CurrentTenant() tenantId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.channels.register({
      tenantId,
      vehicleId: body.vehicleId ? String(body.vehicleId) : null,
      siteId: body.siteId ? String(body.siteId) : null,
      deviceId: body.deviceId ? String(body.deviceId) : null,
      label: String(body.label ?? ''),
      logicalChannel: body.logicalChannel ? Number(body.logicalChannel) : null,
      protocol: String(body.protocol ?? 'RTSP'),
      codec: String(body.codec ?? 'H264'),
      endpoint: body.endpoint ? String(body.endpoint) : null,
      ptz: body.ptz === true,
    });
  }

  @Get('vehicles/:id/channels')
  @RequirePermissions('media.read')
  public async vehicleChannels(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.channels.listByVehicle(tenantId, id);
  }
}
