import {
  JwtAuthGuard,
  type PageRequestDto,
  PermissionsGuard,
  RequirePermissions,
  type UuidParamDto,
  ZodValidationPipe,
  getPrincipal,
  pageRequestSchema,
  uuidParamSchema,
} from '@fleetvision/auth';
import { decodeCursor } from '@fleetvision/shared-kernel';
/**
 * Notifications controller — the notification center API.
 * Base /api/v1/notification/notifications.
 * All routes require JWT. Permissions reuse the alarm read permission.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { NotificationPreference } from '../domain/notification-preference.js';
import type { NotificationChannel, NotificationSeverity } from '../domain/notification-types.js';
import type { NotificationPreferenceRepository } from '../infrastructure/persistence/notification-preference.repository.js';
import type { NotificationRepository } from '../infrastructure/persistence/notification.repository.js';

const updatePreferenceSchema = z.object({
  category: z.string().min(1),
  min_severity: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  channels: z.array(z.enum(['websocket', 'in_app', 'email', 'sms', 'push', 'webhook'])).optional(),
  enabled: z.boolean().optional(),
});

@Controller('api/v1/notification/notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: NotificationPreferenceRepository,
  ) {}

  @Get()
  @RequirePermissions('notification.alert.read')
  public async list(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Query('unreadOnly') unreadOnly?: string,
    @Req() req?: Request,
  ) {
    const p = getPrincipal(req as Request);
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { createdAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    return this.notifications.listPage(
      p.tenantId,
      p.userId,
      page.limit,
      unreadOnly === 'true',
      cursor,
    );
  }

  @Get('unread-count')
  @RequirePermissions('notification.alert.read')
  public async unreadCount(@Req() req: Request) {
    const p = getPrincipal(req);
    return this.notifications.getUnreadCount(p.tenantId, p.userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notification.alert.read')
  public async markRead(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ): Promise<void> {
    const p = getPrincipal(req);
    await this.notifications.markRead(p.tenantId, p.userId, params.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notification.alert.read')
  public async markAllRead(@Req() req: Request): Promise<void> {
    const p = getPrincipal(req);
    await this.notifications.markAllRead(p.tenantId, p.userId);
  }

  @Get('preferences')
  @RequirePermissions('notification.alert.read')
  public async getPreferences(@Req() req: Request) {
    const p = getPrincipal(req);
    return { data: await this.preferences.listForUser(p.tenantId, p.userId) };
  }

  @Put('preferences')
  @RequirePermissions('notification.alert.read')
  public async updatePreference(
    @Body(new ZodValidationPipe(updatePreferenceSchema))
    body: {
      category: string;
      min_severity?: NotificationSeverity;
      channels?: NotificationChannel[];
      enabled?: boolean;
    },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const existing = await this.preferences.getOrDefault(p.tenantId, p.userId, body.category);
    const pref = new NotificationPreference({
      tenantId: p.tenantId,
      userId: p.userId,
      category: body.category,
      minSeverity: body.min_severity ?? existing.minSeverity,
      channels: body.channels ?? existing.channels,
      enabled: body.enabled ?? existing.enabled,
    });
    await this.preferences.upsert(pref);
    return { data: pref };
  }
}
