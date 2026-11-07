/**
 * Driver photos — cabin snapshots and which driver each one shows.
 *
 *   GET    /api/v1/driver-photos                 ?matchStatus&driverId&vehicleId&readyOnly&before&limit
 *   GET    /api/v1/driver-photos/counts
 *   GET    /api/v1/driver-photos/:id/image       image/jpeg
 *   PUT    /api/v1/driver-photos/:id/driver      { driverId: uuid | null }  — file / move / clear
 *   DELETE /api/v1/driver-photos/:id
 *   POST   /api/v1/driver-photos/capture         { deviceId }  — snapshot now
 */
import { CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { DriverPhotoService } from '../application/driver-photo.service.js';
import { actorFrom } from './shared/actor.js';
import { ZodValidationPipe } from './shared/zod-validation.pipe.js';
import { DRIVER_PHOTO_SERVICE } from './tokens.js';

const listSchema = z.object({
  matchStatus: z.enum(['UNASSIGNED', 'AUTO', 'CONFIRMED']).optional(),
  driverId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  readyOnly: z.enum(['true', 'false']).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(48),
});
type ListQuery = z.infer<typeof listSchema>;

const assignSchema = z.object({ driverId: z.string().uuid().nullable() });
type AssignBody = z.infer<typeof assignSchema>;

const captureSchema = z.object({ deviceId: z.string().uuid() });
type CaptureBody = z.infer<typeof captureSchema>;

@Controller('api/v1/driver-photos')
export class DriverPhotosController {
  constructor(@Inject(DRIVER_PHOTO_SERVICE) private readonly photos: DriverPhotoService) {}

  @Get()
  @RequirePermissions('fleet.driver.read')
  public async list(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Query(new ZodValidationPipe(listSchema)) query: unknown,
  ) {
    const q = query as ListQuery;
    const rows = await this.photos.list(actorFrom(auth, req), {
      matchStatus: q.matchStatus,
      driverId: q.driverId,
      vehicleId: q.vehicleId,
      readyOnly: q.readyOnly === 'true',
      before: q.before ? new Date(q.before) : undefined,
      limit: q.limit,
    });
    const last = rows[rows.length - 1];
    return {
      data: rows,
      nextBefore: rows.length === q.limit && last ? last.triggeredAt.toISOString() : null,
    };
  }

  @Get('counts')
  @RequirePermissions('fleet.driver.read')
  public async counts(@CurrentUser() auth: AuthenticatedContext, @Req() req: Request) {
    return { data: await this.photos.counts(actorFrom(auth, req)) };
  }

  @Get(':id/image')
  @RequirePermissions('fleet.driver.read')
  public async image(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const bytes = await this.photos.image(actorFrom(auth, req), id);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return new StreamableFile(bytes, { type: 'image/jpeg', length: bytes.length });
  }

  @Put(':id/driver')
  @RequirePermissions('fleet.driver.update')
  public async assign(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(assignSchema)) body: AssignBody,
  ) {
    return { data: await this.photos.assign(actorFrom(auth, req), id, body.driverId) };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('fleet.driver.update')
  public async remove(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.photos.remove(actorFrom(auth, req), id);
  }

  @Post('capture')
  @RequirePermissions('fleet.driver.update')
  public async capture(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Body(new ZodValidationPipe(captureSchema)) body: CaptureBody,
  ) {
    return { data: await this.photos.captureNow(actorFrom(auth, req), body.deviceId) };
  }
}
