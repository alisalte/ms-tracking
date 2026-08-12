import { type PageRequestDto, pageRequestSchema } from '@fleetvision/auth';
import { type Page, decodeCursor } from '@fleetvision/shared-kernel';
/**
 * Users controller — admin user management. Base `/api/v1/iam/users`. All
 * routes require a JWT + the relevant IAM permission. tenant_id comes from the
 * principal, never the body (INV-I02).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import {
  AssignRoleUseCase,
  CreateUserUseCase,
  UpdateUserUseCase,
} from '../../application/index.js';
import { NotFoundError } from '../../domain/errors.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import { assignRoleSchema, createUserSchema, updateUserSchema } from '../auth/auth.dto.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import { PermissionsGuard, RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';
import { actorFromRequest } from '../shared/request-context.js';
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
  public async list(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Req() req: Request,
  ): Promise<
    Page<{
      id: string;
      tenant_id: string;
      email: string;
      username: string;
      status: string;
      display_name: string | null;
      roles: readonly string[];
      mfa_enabled: boolean;
      last_login_at: Date | null;
    }>
  > {
    const p = getPrincipal(req);
    // Decode the opaque cursor into the keyset (createdAt, id); first page = undefined.
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { createdAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    const result = await this.users.listPage(p.tenantId, page.limit, cursor);
    return {
      data: result.data.map((u) => this.toView(u)),
      nextCursor: result.nextCursor,
    };
  }

  @Get(':id')
  @RequirePermissions('iam.user.read')
  public async get(@Param('id') id: string, @Req() req: Request) {
    const p = getPrincipal(req);
    const user = await this.users.findById(p.tenantId, id);
    // 404 (not {data:null}) — generic message, no tenant leakage (ARR SEC rules).
    if (!user) throw new NotFoundError('User');
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
      ...actorFromRequest(req),
    });
    return { data: this.toView(user) };
  }

  @Put(':id')
  @RequirePermissions('iam.user.update')
  public async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: {
      email?: string;
      display_name?: string;
    },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const user = await this.updateUserUseCase.execute({
      tenantId: p.tenantId,
      userId: id,
      email: body.email,
      displayName: body.display_name,
      ...actorFromRequest(req),
    });
    return { data: this.toView(user) };
  }

  @Post(':id/roles')
  @RequirePermissions('iam.role.assign')
  @HttpCode(204)
  public async assignRole(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignRoleSchema)) body: { role_id: string },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    await this.assignRoleUseCase.execute({
      tenantId: p.tenantId,
      userId: id,
      roleId: body.role_id,
      ...actorFromRequest(req),
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
