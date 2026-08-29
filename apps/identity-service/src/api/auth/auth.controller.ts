import { Public } from '@fleetvision/auth';
/**
 * Auth controller — login, refresh, logout, /me, sessions. Base path
 * `/api/v1/auth` (ARR API-1, Authentication.md §5).
 *
 * Login/register/refresh are PUBLIC (no Bearer required). The tenant is
 * supplied via the `X-Tenant-Id` header, which may carry either a UUID or a
 * tenant name/slug (e.g. "FleetVision"); the name is resolved server-side to
 * the canonical UUID before reaching the use case (INV-I02: tenant_id is always
 * server-verified, never trusted from the request body).
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { LoginUseCase, LogoutUseCase, RefreshTokenUseCase } from '../../application/index.js';
import { InvalidCredentialsError } from '../../domain/errors.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import { getPrincipal } from '../shared/principal.js';
import { ZodValidationPipe } from '../shared/zod-validation.pipe.js';
import { loginSchema, refreshSchema } from './auth.dto.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshUseCase: RefreshTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly tenants: TenantRepository,
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
  ) {}

  /**
   * Resolve the `X-Tenant-Id` header to a canonical tenant UUID.
   *
   * Accepts a UUID (passed through) or a tenant name/slug like "FleetVision"
   * (resolved via `iam.tenants`, case-insensitive). This keeps INV-I02 intact —
   * the tenant_id reaching the use case is always server-verified — while
   * letting a human type a friendly name instead of an unguessable UUID. Throws
   * a generic error (surfaced as 401 by the exception filter) when the tenant
   * is missing/unknown, to avoid a tenant-enumeration oracle.
   */
  private async resolveTenantId(rawTenantId: string | undefined): Promise<string> {
    if (!rawTenantId || !rawTenantId.trim()) {
      // Missing header — still a credentials failure (generic, no oracle).
      throw new InvalidCredentialsError();
    }
    const trimmed = rawTenantId.trim();
    // Already a UUID — accept directly (the use case still verifies the tenant).
    if (UUID_RE.test(trimmed)) return trimmed;
    // Otherwise treat it as a tenant name/slug and resolve to the UUID.
    const resolved = await this.tenants.resolveId(trimmed);
    if (!resolved) {
      // Unknown tenant — generic credentials error (no tenant enumeration).
      throw new InvalidCredentialsError();
    }
    return resolved;
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  public async login(
    @Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string },
    @Req() req: Request,
  ): Promise<{
    data: {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
      user: {
        id: string;
        email: string;
        tenant_id: string;
        tenant_name: string;
        roles: readonly string[];
      };
    };
  }> {
    const tenantId = await this.resolveTenantId(req.headers['x-tenant-id'] as string | undefined);
    const result = await this.loginUseCase.execute({
      email: body.email,
      password: body.password,
      tenantId,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      data: {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        user: {
          id: result.user.id,
          email: result.user.email,
          tenant_id: result.user.tenantId,
          tenant_name: result.user.tenantName,
          roles: result.user.roles,
        },
      },
    };
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  public async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: { refresh_token: string },
    @Req() req: Request,
  ): Promise<{ data: { access_token: string; refresh_token: string; expires_in: number } }> {
    const tenantId = await this.resolveTenantId(req.headers['x-tenant-id'] as string | undefined);
    const result = await this.refreshUseCase.execute({
      refreshToken: body.refresh_token,
      tenantId,
    });
    return {
      data: {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_in: result.expiresIn,
      },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logout(@Req() req: Request): Promise<void> {
    const p = getPrincipal(req);
    await this.logoutUseCase.execute({
      tenantId: p.tenantId,
      userId: p.userId,
      sessionId: p.sessionId,
      accessJti: p.jti,
      accessTtlRemainingSeconds: 900,
      all: false,
    });
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logoutAll(@Req() req: Request): Promise<void> {
    const p = getPrincipal(req);
    await this.logoutUseCase.execute({
      tenantId: p.tenantId,
      userId: p.userId,
      sessionId: p.sessionId,
      accessJti: p.jti,
      accessTtlRemainingSeconds: 900,
      all: true,
    });
  }

  @Get('me')
  public async me(@Req() req: Request): Promise<{
    data: {
      id: string;
      email: string;
      tenant_id: string;
      tenant_name: string;
      roles: readonly string[];
      permissions: readonly string[];
    };
  }> {
    const p = getPrincipal(req);
    // Email is not carried in the JWT — hydrate it from the user record so the
    // dashboard can show the signed-in identity (Sprint E §5). Role names and
    // the tenant title are resolved from the DB so a token minted before this
    // change (roles as UUIDs) still surfaces human labels.
    const [user, tenant, roleNames] = await Promise.all([
      this.users.findById(p.tenantId, p.userId),
      this.tenants.findById(p.tenantId),
      this.roles.namesForUser(p.tenantId, p.userId),
    ]);
    return {
      data: {
        id: p.userId,
        email: user?.email ?? '',
        tenant_id: p.tenantId,
        tenant_name: tenant?.name ?? '',
        roles: roleNames.length > 0 ? roleNames : p.roles,
        permissions: p.permissions,
      },
    };
  }
}
