/**
 * Tenants controller — provisioning (platform), self-view, and suspend/
 * reactivate. Provisioning is a platform-SaaS-Ops operation
 * (`billing.tenant.manage`); self-view is any authenticated user (own tenant).
 */
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { ProvisionTenantUseCase } from '../../application/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import { PermissionsGuard, RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TenantsController {
  constructor(
    private readonly provisionUseCase: ProvisionTenantUseCase,
    private readonly tenants: TenantRepository,
  ) {}

  /** Provision a new tenant + admin (platform SaaS-Ops). */
  @Post('tenants')
  @RequirePermissions('billing.tenant.manage')
  public async provision(
    @Body()
    body: {
      name: string;
      tier: 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
      region: string;
      admin_email: string;
      admin_username: string;
      admin_password: string;
    },
  ) {
    const result = await this.provisionUseCase.execute({
      name: body.name,
      tier: body.tier,
      region: body.region,
      adminEmail: body.admin_email,
      adminUsername: body.admin_username,
      adminPassword: body.admin_password,
    });
    return {
      data: {
        tenant_id: result.tenantId,
        admin_user_id: result.adminUserId,
        status: 'ACTIVE',
      },
    };
  }

  /** Self-view: any authenticated user reads their own tenant. */
  @Get('tenant')
  public async self(@Req() req: Request) {
    const p = getPrincipal(req);
    const tenant = await this.tenants.findById(p.tenantId);
    if (!tenant) return { data: null };
    return {
      data: {
        id: tenant.id as string,
        name: tenant.name,
        tier: tenant.tier,
        region: tenant.region,
        status: tenant.status,
      },
    };
  }

  @Get('tenants/:id')
  @RequirePermissions('billing.tenant.read')
  public async get(@Param('id') id: string) {
    const tenant = await this.tenants.findById(id);
    if (!tenant) return { data: null };
    return {
      data: {
        id: tenant.id as string,
        name: tenant.name,
        tier: tenant.tier,
        region: tenant.region,
        status: tenant.status,
      },
    };
  }
}
