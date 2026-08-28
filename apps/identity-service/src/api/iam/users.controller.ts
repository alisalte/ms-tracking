/**
 * Users controller — admin user management. Base `/api/v1/iam/users`. All
 * routes require a JWT + the relevant IAM permission. tenant_id comes from the
 * principal, never the body (INV-I02).
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import {
  AssignRoleUseCase,
  ChangeUserStatusUseCase,
  CreateUserUseCase,
  UpdateUserUseCase,
} from '../../application/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import { changeUserStatusSchema, createUserSchema } from '../auth/auth.dto.js';
import { RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';
import { ZodValidationPipe } from '../shared/zod-validation.pipe.js';

/**
 * Users admin management. Authentication + RBAC are enforced by the global
 * guards; each route declares its permission. tenant_id comes from the
 * principal (INV-I02).
 */
@Controller('api/v1/iam/users')
export class UsersController {
  constructor(
    private readonly createUserUseCase: CreateUserUseCase,
    private readonly updateUserUseCase: UpdateUserUseCase,
    private readonly assignRoleUseCase: AssignRoleUseCase,
    private readonly changeStatusUseCase: ChangeUserStatusUseCase,
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

  @Patch(':id/status')
  @RequirePermissions('iam.user.manage')
  public async changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeUserStatusSchema))
    body: { status: 'active' | 'suspended' | 'deactivated'; reason?: string },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const user = await this.changeStatusUseCase.execute({
      tenantId: p.tenantId,
      userId: id,
      status: body.status,
      reason: body.reason,
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
