/**
 * Roles + permission catalog — admin access control (IAM §6).
 *
 *   GET  /iam/roles              — list tenant roles (iam.role.read)
 *   POST /iam/roles              — create a custom role (iam.role.create)
 *   PUT  /iam/roles/:id          — replace custom-role permissions (iam.role.update)
 *   GET  /iam/permissions        — canonical catalog grouped by domain
 */
import { ALL_PERMISSIONS, SYSTEM_ROLES, WILDCARD_PERMISSION } from '@fleetvision/auth';
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Role } from '../../domain/index.js';
import { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
import { RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';

const DOMAIN_LABEL: Record<string, string> = {
  iam: 'admin.permissions.domain.iam',
  fleet: 'admin.permissions.domain.fleet',
  vehicle: 'admin.permissions.domain.vehicle',
  device: 'admin.permissions.domain.device',
  tracking: 'admin.permissions.domain.tracking',
  maps: 'admin.permissions.domain.maps',
  media: 'admin.permissions.domain.media',
  telemetry: 'admin.permissions.domain.telemetry',
  notification: 'admin.permissions.domain.notification',
  report: 'admin.permissions.domain.analytics',
  audit: 'admin.permissions.domain.audit',
  billing: 'admin.permissions.domain.billing',
};

@Controller('api/v1/iam')
export class RolesController {
  constructor(private readonly roles: RoleRepository) {}

  @Get('roles')
  @RequirePermissions('iam.role.read')
  public async list(@Req() req: Request) {
    const p = getPrincipal(req);
    const listed = await this.roles.listWithMemberCounts(p.tenantId);
    return { data: listed.map((row) => this.toView(row.role, row.memberCount)) };
  }

  @Post('roles')
  @RequirePermissions('iam.role.create')
  public async create(
    @Body() body: { name?: string; description?: string; permissions?: string[] },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const name = (body.name ?? '').trim();
    if (name.length < 2 || name.length > 64) {
      throw new HttpException('name must be 2–64 characters', HttpStatus.BAD_REQUEST);
    }
    const permissions = this.sanitizePermissions(body.permissions ?? []);
    const role = Role.create(randomUUID(), {
      tenantId: p.tenantId,
      name,
      description: body.description,
      permissions,
    });
    await this.roles.save(role);
    return { data: this.toView(role, 0) };
  }

  @Put('roles/:id')
  @RequirePermissions('iam.role.update')
  public async update(
    @Param('id') id: string,
    @Body() body: { permissions?: string[] },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const existing = await this.roles.findById(p.tenantId, id);
    if (!existing) throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
    if (existing.isSystem) {
      throw new HttpException('System roles are immutable', HttpStatus.FORBIDDEN);
    }
    const permissions = this.sanitizePermissions(body.permissions ?? []);
    const updated = await this.roles.replacePermissions(p.tenantId, id, permissions);
    const listed = await this.roles.listWithMemberCounts(p.tenantId);
    const memberCount = listed.find((r) => (r.role.id as string) === id)?.memberCount ?? 0;
    return { data: this.toView(updated, memberCount) };
  }

  @Get('permissions')
  @RequirePermissions('iam.role.read')
  public catalog() {
    const groups = new Map<string, string[]>();
    for (const permission of ALL_PERMISSIONS) {
      const domain = permission.split('.')[0] ?? 'other';
      const list = groups.get(domain) ?? [];
      list.push(permission);
      groups.set(domain, list);
    }
    return {
      data: [...groups.entries()].map(([domain, permissions]) => ({
        domain,
        label_key: DOMAIN_LABEL[domain] ?? `admin.permissions.domain.${domain}`,
        permissions,
      })),
    };
  }

  private sanitizePermissions(raw: string[]): string[] {
    const allowed = new Set<string>(ALL_PERMISSIONS);
    const out: string[] = [];
    for (const p of raw) {
      if (p === WILDCARD_PERMISSION) {
        throw new HttpException('Wildcard cannot be granted to custom roles', HttpStatus.BAD_REQUEST);
      }
      if (!allowed.has(p)) {
        throw new HttpException(`Unknown permission: ${p}`, HttpStatus.BAD_REQUEST);
      }
      if (!out.includes(p)) out.push(p);
    }
    return out;
  }

  private toView(role: Role, memberCount: number) {
    const seed = SYSTEM_ROLES.find((s) => s.name === role.name);
    return {
      id: role.id as string,
      name: role.name,
      description: role.description ?? '',
      is_system: role.isSystem,
      permission_keys: [...role.permissions],
      member_count: memberCount,
      mfa_required: seed?.mfaRequired ?? false,
    };
  }
}
