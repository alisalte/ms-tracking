import { randomUUID } from 'node:crypto';
/**
 * Roles + permission catalog — admin access control (IAM §6).
 *
 *   GET  /iam/roles              — list tenant roles (iam.role.read)
 *   POST /iam/roles              — create a custom role (iam.role.create)
 *   PUT  /iam/roles/:id          — replace custom-role permissions (iam.role.update)
 *   GET  /iam/permissions        — canonical catalog grouped by domain
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '../../domain/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
import { RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';
import { permissionCatalog, roleView, sanitizeCustomPermissions } from './permission-catalog.js';

@Controller('api/v1/iam')
export class RolesController {
  constructor(private readonly roles: RoleRepository) {}

  @Get('roles')
  @RequirePermissions('iam.role.read')
  public async list(@Req() req: Request) {
    const p = getPrincipal(req);
    const listed = await this.roles.listWithMemberCounts(p.tenantId);
    return { data: listed.map((row) => roleView(row.role, row.memberCount)) };
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
    const permissions = sanitizeCustomPermissions(body.permissions ?? []);
    const role = Role.create(randomUUID(), {
      tenantId: p.tenantId,
      name,
      description: body.description,
      permissions,
    });
    await this.roles.save(role);
    return { data: roleView(role, 0) };
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
    const permissions = sanitizeCustomPermissions(body.permissions ?? []);
    const updated = await this.roles.replacePermissions(p.tenantId, id, permissions);
    const listed = await this.roles.listWithMemberCounts(p.tenantId);
    const memberCount = listed.find((r) => (r.role.id as string) === id)?.memberCount ?? 0;
    return { data: roleView(updated, memberCount) };
  }

  @Get('permissions')
  @RequirePermissions('iam.role.read')
  public catalog() {
    return { data: permissionCatalog() };
  }
}
