/**
 * Platform console: per-tenant SMTP settings for scheduled-report email.
 * The path id is the customer tenant (the operator's JWT tenant is not);
 * gated by `billing.tenant.manage` like the other platform tenant routes.
 *
 *   GET    /api/v1/platform/tenants/:tenantId/report-email
 *   PUT    /api/v1/platform/tenants/:tenantId/report-email
 *   DELETE /api/v1/platform/tenants/:tenantId/report-email
 *   POST   /api/v1/platform/tenants/:tenantId/report-email/test
 */
import { CurrentUser, RequirePermissions, ZodValidationPipe } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import {
  TenantEmailSettingsError,
  type TenantEmailSettingsService,
} from '../application/tenant-email-settings.service.js';
import { TENANT_EMAIL_SETTINGS_SERVICE } from './tokens.js';

const saveSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().max(254).nullable().optional(),
  password: z.string().max(512).optional(),
  fromAddress: z.string().trim().email().max(254),
});
type SaveDto = z.infer<typeof saveSchema>;

const testSchema = z.object({ to: z.string().trim().email().max(254) });
type TestDto = z.infer<typeof testSchema>;

@Controller('api/v1/platform/tenants/:tenantId/report-email')
export class PlatformEmailSettingsController {
  constructor(
    @Inject(TENANT_EMAIL_SETTINGS_SERVICE) private readonly service: TenantEmailSettingsService,
  ) {}

  @Get()
  @RequirePermissions('billing.tenant.manage')
  public async get(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return { data: await this.guard(() => this.service.get(tenantId)) };
  }

  @Put()
  @RequirePermissions('billing.tenant.manage')
  public async save(
    @CurrentUser() user: AuthenticatedContext,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body(new ZodValidationPipe(saveSchema)) body: SaveDto,
  ) {
    return {
      data: await this.guard(() => this.service.save(tenantId, user?.userId ?? null, body)),
    };
  }

  @Delete()
  @RequirePermissions('billing.tenant.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    await this.guard(() => this.service.remove(tenantId));
  }

  @Post('test')
  @RequirePermissions('billing.tenant.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async test(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body(new ZodValidationPipe(testSchema)) body: TestDto,
  ) {
    await this.guard(() => this.service.sendTest(tenantId, body.to));
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TenantEmailSettingsError) {
        const status =
          err.code === 'NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : err.code === 'UNAVAILABLE'
              ? HttpStatus.UNPROCESSABLE_ENTITY
              : HttpStatus.BAD_REQUEST;
        throw new HttpException({ message: err.message, code: err.code }, status);
      }
      // SMTP/network failures from the test send: surface the reason to the operator.
      if (err instanceof Error && !(err instanceof HttpException)) {
        throw new HttpException(
          { message: err.message, code: 'SMTP_ERROR' },
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw err;
    }
  }
}
