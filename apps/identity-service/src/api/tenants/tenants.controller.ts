/**
 * Tenants controller — provisioning (platform), self-view, and suspend/
 * reactivate. Provisioning and lifecycle transitions are platform-SaaS-Ops
 * operations (`billing.tenant.manage`); self-view is any authenticated user
 * (own tenant).
 */
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { ProvisionTenantUseCase, TenantLifecycleUseCase } from '../../application/index.js';
import { NotFoundError } from '../../domain/errors.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
import { provisionTenantSchema } from '../auth/auth.dto.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import { PermissionsGuard, RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';
import { actorFromRequest } from '../shared/request-context.js';
import { ZodValidationPipe } from '../shared/zod-validation.pipe.js';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TenantsController {
  constructor(
    private readonly provisionUseCase: ProvisionTenantUseCase,
    private readonly lifecycleUseCase: TenantLifecycleUseCase,
    private readonly tenants: TenantRepository,
  ) {}

  /** Provision a new tenant + admin (platform SaaS-Ops). */
  @Post('tenants')
  @RequirePermissions('billing.tenant.manage')
  public async provision(
    @Body(new ZodValidationPipe(provisionTenantSchema))
    body: {
      name: string;
      tier: 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
      region: string;
      admin_email: string;
      admin_username: string;
      admin_password: string;
    },
    @Req() req: Request,
  ) {
    const result = await this.provisionUseCase.execute({
      name: body.name,
      tier: body.tier,
      region: body.region,
      adminEmail: body.admin_email,
      adminUsername: body.admin_username,
      adminPassword: body.admin_password,
      ...actorFromRequest(req),
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
    // 404 (not {data:null}) — generic message, no tenant leakage.
    if (!tenant) throw new NotFoundError('Tenant');
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
    if (!tenant) throw new NotFoundError('Tenant');
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

  /** Suspend a tenant (ACTIVE → SUSPENDED). Platform SaaS-Ops, audited. */
  @Post('tenants/:id/suspend')
  @RequirePermissions('billing.tenant.manage')
  public async suspend(@Param('id') id: string, @Req() req: Request) {
    const result = await this.lifecycleUseCase.suspend({ tenantId: id, ...actorFromRequest(req) });
    return { data: { tenant_id: result.tenantId, status: result.status } };
  }

  /** (Re)activate a tenant (PROVISIONING|SUSPENDED → ACTIVE). Platform SaaS-Ops, audited. */
  @Post('tenants/:id/activate')
  @RequirePermissions('billing.tenant.manage')
  public async activate(@Param('id') id: string, @Req() req: Request) {
    const result = await this.lifecycleUseCase.activate({ tenantId: id, ...actorFromRequest(req) });
    return { data: { tenant_id: result.tenantId, status: result.status } };
  }
}
