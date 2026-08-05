/**
 * Users controller — admin user management. Base `/api/v1/iam/users`. All
 * routes require a JWT + the relevant IAM permission. tenant_id comes from the
 * principal, never the body (INV-I02).
 */
import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import {
  AssignRoleUseCase,
  CreateUserUseCase,
  UpdateUserUseCase,
} from '../../application/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import { createUserSchema } from '../auth/auth.dto.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import { PermissionsGuard, RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';
import { ZodValidationPipe } from '../shared/zod-validation.pipe.js';

@Controller('api/v1/iam/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(
    private readonly createUserUseCase: CreateUserUseCase,
    private readonly updateUserUseCase: UpdateUserUseCase,
    private readonly assignRoleUseCase: AssignRoleUseCase,
    private readonly users: UserRepository,
  ) {}

  @Get()
  @RequirePermissions('iam.user.read')
  public async list(@Req() req: Request) {
    const p = getPrincipal(req);
    const { rows, total } = await this.users.list(p.tenantId, 50, 0);
    return {
      data: rows.map((u) => this.toView(u)),
      meta: { total },
    };
  }

  @Get(':id')
  @RequirePermissions('iam.user.read')
  public async get(@Param('id') id: string, @Req() req: Request) {
    const p = getPrincipal(req);
    const user = await this.users.findById(p.tenantId, id);
    if (!user) return { data: null };
    return { data: this.toView(user) };
  }

  @Post()
  @RequirePermissions('iam.user.create')
  public async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: {
      email: string;
      username: string;
      password: string;
      display_name?: string;
    },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const user = await this.createUserUseCase.execute({
      tenantId: p.tenantId,
      email: body.email,
      username: body.username,
      password: body.password,
      displayName: body.display_name,
    });
    return { data: this.toView(user) };
  }

  @Put(':id')
  @RequirePermissions('iam.user.update')
  public async update(
    @Param('id') id: string,
    @Body() body: { email?: string; display_name?: string },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const user = await this.updateUserUseCase.execute({
      tenantId: p.tenantId,
      userId: id,
      email: body.email,
      displayName: body.display_name,
    });
    return { data: this.toView(user) };
  }

  @Post(':id/roles')
  @RequirePermissions('iam.role.assign')
  @HttpCode(204)
  public async assignRole(
    @Param('id') id: string,
    @Body() body: { role_id: string },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    await this.assignRoleUseCase.execute({
      tenantId: p.tenantId,
      userId: id,
      roleId: body.role_id,
    });
  }

  private toView(u: import('../../domain/index.js').User) {
    return {
      id: u.id as string,
      tenant_id: u.tenantId,
      email: u.email,
      username: u.username,
      status: u.status,
      display_name: u.displayName,
      roles: u.roles,
      mfa_enabled: u.mfaEnabled,
      last_login_at: u.lastLoginAt,
    };
  }
}
