/**
 * FTP alarm-photo upload provisioning:
 *
 *   POST /api/v1/devices/:deviceId/ftp-photo-upload   (sends B64 with this
 *        platform's FTP host/port and the unit's derived credentials)
 */
import { CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import { Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { FtpPhotoReceiver } from '../application/ftp-photo-receiver.js';
import { actorFrom } from './shared/actor.js';
import { FTP_PHOTO_RECEIVER } from './tokens.js';

@Controller('api/v1/devices/:deviceId/ftp-photo-upload')
export class DeviceFtpPhotoController {
  constructor(@Inject(FTP_PHOTO_RECEIVER) private readonly ftp: FtpPhotoReceiver) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('telemetry.command.send')
  public async enable(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    const record = await this.ftp.enableForDevice(actorFrom(auth, req), deviceId);
    return { data: record };
  }
}
