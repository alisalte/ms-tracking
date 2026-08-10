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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
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
  public async openStream(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const tenantId = tenantOf(req);
    const channelId = String(body.channelId ?? '');
    if (!channelId) throw new HttpException('channelId required', HttpStatus.BAD_REQUEST);
    const channel = await this.channels.findById(channelId, tenantId);
    if (!channel) throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
    return this.streams.openSession(channel, {
      userId: body.userId ? String(body.userId) : null,
      quality: body.quality ? String(body.quality) : 'auto',
      mode: body.mode ? String(body.mode) : 'LIVE',
    });
  }

  @Post('streams/batch')
  public async openBatch(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const tenantId = tenantOf(req);
    const channelIds = (body.channelIds as string[]) ?? [];
    if (channelIds.length === 0) {
      throw new HttpException('channelIds required', HttpStatus.BAD_REQUEST);
    }
    const results = await Promise.allSettled(
      channelIds.map(async (cid) => {
        const channel = await this.channels.findById(cid, tenantId);
        if (!channel) throw new Error(`Channel ${cid} not found`);
        return this.streams.openSession(channel, {
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
  public async closeStream(@Param('id') id: string) {
    await this.streams.closeSession(id);
    return { closed: true };
  }

  // --- Channels ---

  @Get('channels')
  public async listChannels(
    @Query('vehicleId') vehicleId: string | undefined,
    @Req() req: Request,
  ) {
    const tenantId = tenantOf(req);
    return vehicleId
      ? this.channels.listByVehicle(tenantId, vehicleId)
      : this.channels.listByTenant(tenantId);
  }

  @Get('channels/:id')
  public async getChannel(@Param('id') id: string, @Req() req: Request) {
    const ch = await this.channels.findById(id, tenantOf(req));
    if (!ch) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return ch;
  }

  @Post('channels')
  public async registerChannel(@Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.channels.register({
      tenantId: tenantOf(req),
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
  public async vehicleChannels(@Param('id') id: string, @Req() req: Request) {
    return this.channels.listByVehicle(tenantOf(req), id);
  }
}

function tenantOf(req: Request): string {
  const tid =
    (req.headers['tenant-id'] as string | undefined) ??
    (req.query['tenant-id'] as string | undefined);
  if (!tid)
    throw new HttpException('tenant-id header or query is required.', HttpStatus.BAD_REQUEST);
  return tid;
}
