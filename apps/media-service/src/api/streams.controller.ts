import {
  JwtAuthGuard,
  type PageRequestDto,
  ZodValidationPipe,
  getPrincipal,
  pageRequestSchema,
} from '@fleetvision/auth';
import { decodeCursor } from '@fleetvision/shared-kernel';
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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ChannelManager } from '../application/channel-manager.js';
import type { StreamManager } from '../application/stream-manager.js';
<<<<<<< HEAD
import {
  type OpenStreamDto,
  type RegisterChannelDto,
  openStreamSchema,
  registerChannelSchema,
} from './media.dto.js';
=======
>>>>>>> 5bdd11003cc6ed2a06307b253ebd40c49da3ea6e
import { CHANNEL_MANAGER, STREAM_MANAGER } from './tokens.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class StreamsController {
  constructor(
    @Inject(CHANNEL_MANAGER) private readonly channels: ChannelManager,
    @Inject(STREAM_MANAGER) private readonly streams: StreamManager,
  ) {}

  // --- Stream sessions ---

  @Post('streams')
<<<<<<< HEAD
  public async openStream(
    @Body(new ZodValidationPipe(openStreamSchema)) body: OpenStreamDto,
    @Req() req: Request,
  ) {
=======
  public async openStream(@Body() body: Record<string, unknown>, @Req() req: Request) {
>>>>>>> 5bdd11003cc6ed2a06307b253ebd40c49da3ea6e
    const tenantId = tenantOf(req);
    const channel = await this.channels.findById(body.channelId, tenantId);
    if (!channel) throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
    return this.streams.openSession(channel, {
      userId: body.userId ?? null,
      quality: body.quality ?? 'auto',
      mode: body.mode ?? 'LIVE',
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
  public async closeStream(@Param('id') id: string, @Req() req: Request) {
    // Verify the session belongs to the caller's tenant before closing (the
    // internal closeSession path is tenant-scoped via the session's own record).
    const ok = await this.streams.closeSessionForTenant(id, getPrincipal(req).tenantId);
    if (!ok) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return { closed: true };
  }

  // --- Channels ---

  @Get('channels')
  public async listChannels(
    @Query('vehicleId') vehicleId: string | undefined,
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Req() req: Request,
  ) {
    const tenantId = tenantOf(req);
    // vehicle-scoped lookups are bounded (a vehicle has few channels) — return
    // the full set; tenant-wide listings use cursor pagination.
    if (vehicleId) {
      const data = await this.channels.listByVehicle(tenantId, vehicleId);
      return { data, nextCursor: null };
    }
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { createdAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    return this.channels.listByTenantPage(tenantId, page.limit, cursor);
  }

  @Get('channels/:id')
  public async getChannel(@Param('id') id: string, @Req() req: Request) {
    const ch = await this.channels.findById(id, tenantOf(req));
    if (!ch) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return ch;
  }

  @Post('channels')
  public async registerChannel(
    @Body(new ZodValidationPipe(registerChannelSchema)) body: RegisterChannelDto,
    @Req() req: Request,
  ) {
    return this.channels.register({
      tenantId: tenantOf(req),
      vehicleId: body.vehicleId ?? null,
      siteId: body.siteId ?? null,
      deviceId: body.deviceId ?? null,
      label: body.label,
      logicalChannel: body.logicalChannel ?? null,
      protocol: body.protocol,
      codec: body.codec,
      endpoint: body.endpoint ?? null,
      ptz: body.ptz ?? false,
    });
  }

  @Get('vehicles/:id/channels')
  public async vehicleChannels(@Param('id') id: string, @Req() req: Request) {
    return this.channels.listByVehicle(tenantOf(req), id);
  }
}

/** Derive the tenant id from the verified JWT principal (INV-I02). */
function tenantOf(req: Request): string {
<<<<<<< HEAD
  return getPrincipal(req).tenantId;
=======
  const tid =
    (req.headers['tenant-id'] as string | undefined) ??
    (req.query['tenant-id'] as string | undefined);
  if (!tid)
    throw new HttpException('tenant-id header or query is required.', HttpStatus.BAD_REQUEST);
  return tid;
>>>>>>> 5bdd11003cc6ed2a06307b253ebd40c49da3ea6e
}
