import {
  type PageRequestDto,
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
 * All routes require JWT + the Sprint H notification permissions. Tenant and
 * user scoping always come from the authenticated principal (never request
 * input). Cursor pagination — unlimited history is never returned.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { NotificationProviderRegistry } from '../application/channels/provider-registry.js';
import { NotificationPreference } from '../domain/notification-preference.js';
import type { NotificationChannel, NotificationSeverity } from '../domain/notification-types.js';
import type { NotificationDeliveryRepository } from '../infrastructure/persistence/notification-delivery.repository.js';
import type { NotificationPreferenceRepository } from '../infrastructure/persistence/notification-preference.repository.js';
import type { NotificationRepository } from '../infrastructure/persistence/notification.repository.js';
import { NOTIFICATION_PROVIDER_REGISTRY } from './notification.tokens.js';

const updatePreferenceSchema = z.object({
  category: z.string().min(1),
  min_severity: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  channels: z.array(z.enum(['websocket', 'in_app', 'email', 'sms', 'push', 'webhook'])).optional(),
  enabled: z.boolean().optional(),
});

const listFiltersSchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
  eventType: z.string().min(1).max(64).optional(),
  severity: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  vehicleId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  scope: z.enum(['own', 'all']).optional(),
});

@Controller('api/v1/notification/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: NotificationPreferenceRepository,
    private readonly deliveries: NotificationDeliveryRepository,
    @Inject(NOTIFICATION_PROVIDER_REGISTRY) private readonly registry: NotificationProviderRegistry,
  ) {}

  @Get()
  @RequirePermissions('notification.read')
  public async list(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Query(new ZodValidationPipe(listFiltersSchema)) filters: z.infer<typeof listFiltersSchema>,
    @Req() req?: Request,
  ) {
    const p = getPrincipal(req as Request);
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { createdAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    // Tenant-wide history requires notification.read.all; everyone else sees
    // only their own (+ broadcast) notifications.
    const tenantWide = filters.scope === 'all';
    if (tenantWide && !this.hasPermission(req as Request, 'notification.read.all')) {
      throw new ForbiddenException(
        'Tenant-wide notification history requires notification.read.all.',
      );
    }
    return this.notifications.listPage(
      p.tenantId,
      tenantWide ? null : p.userId,
      page.limit,
      filters.unreadOnly === 'true',
      cursor,
      {
        eventType: filters.eventType,
        severity: filters.severity,
        vehicleId: filters.vehicleId,
        from: filters.from ? new Date(filters.from) : undefined,
        to: filters.to ? new Date(filters.to) : undefined,
      },
    );
  }

  @Get('unread-count')
  @RequirePermissions('notification.read')
  public async unreadCount(@Req() req: Request) {
    const p = getPrincipal(req);
    return this.notifications.getUnreadCount(p.tenantId, p.userId);
  }

  @Get('channels')
  @RequirePermissions('notification.read')
  public async channelHealth() {
    // Provider readiness — CONFIGURED/DISABLED only, no secrets (Sprint H §48).
    return { data: this.registry.healthSnapshot() };
  }

  @Get('preferences')
  @RequirePermissions('notification.preference.read')
  public async getPreferences(@Req() req: Request) {
    const p = getPrincipal(req);
    return { data: await this.preferences.listForUser(p.tenantId, p.userId) };
  }

  @Put('preferences')
  @RequirePermissions('notification.preference.write')
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
    // A user may only modify their OWN preferences (Sprint H §45/§46).
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

  @Get(':id')
  @RequirePermissions('notification.read')
  public async getDetail(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const notification = await this.notifications.getById(p.tenantId, p.userId, params.id);
    if (!notification) return { data: null };
    // Delivery attempts timeline (Sprint H §30/§41).
    const deliveries = await this.deliveries.listForNotification(p.tenantId, notification.id);
    return { data: { ...notification, deliveries } };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notification.read')
  public async markRead(
    @Param(new ZodValidationPipe(uuidParamSchema)) params: UuidParamDto,
    @Req() req: Request,
  ): Promise<void> {
    const p = getPrincipal(req);
    await this.notifications.markRead(p.tenantId, p.userId, params.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notification.read')
  public async markAllRead(@Req() req: Request): Promise<void> {
    const p = getPrincipal(req);
    await this.notifications.markAllRead(p.tenantId, p.userId);
  }

  /** Permission check against the JWT-embedded permission list. */
  private hasPermission(req: Request, permission: string): boolean {
    const granted = getPrincipal(req).permissions ?? [];
    return granted.includes('*') || granted.includes(permission);
  }
}
