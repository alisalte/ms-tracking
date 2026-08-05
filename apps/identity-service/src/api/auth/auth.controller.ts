/**
 * Auth controller — login, refresh, logout, /me, sessions. Base path
 * `/api/v1/auth` (ARR API-1, Authentication.md §5).
 *
 * Login/register/refresh are PUBLIC (no Bearer required). The tenant_id for
 * login is supplied as a header `X-Tenant-Id` (set by the gateway from the
 * client's selected tenant context — NOT from the body, per INV-I02).
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime for reflect-metadata.
import { LoginUseCase, LogoutUseCase, RefreshTokenUseCase } from '../../application/index.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import { getPrincipal } from '../shared/principal.js';
import { ZodValidationPipe } from '../shared/zod-validation.pipe.js';
import { loginSchema, refreshSchema } from './auth.dto.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshUseCase: RefreshTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
  ) {}

  @Post('login')
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
      user: { id: string; email: string; tenant_id: string; roles: readonly string[] };
    };
  }> {
    const tenantId = req.headers['x-tenant-id'] as string;
    if (!tenantId) {
      throw new Error('X-Tenant-Id header is required.');
    }
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
          roles: result.user.roles,
        },
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  public async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: { refresh_token: string },
    @Req() req: Request,
  ): Promise<{ data: { access_token: string; refresh_token: string; expires_in: number } }> {
    const tenantId = req.headers['x-tenant-id'] as string;
    if (!tenantId) {
      throw new Error('X-Tenant-Id header is required.');
    }
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  public me(@Req() req: Request): {
    data: {
      id: string;
      email: string;
      tenant_id: string;
      roles: readonly string[];
      permissions: readonly string[];
    };
  } {
    const p = getPrincipal(req);
    return {
      data: {
        id: p.userId,
        email: '', // email not carried in JWT; a use-case could hydrate it
        tenant_id: p.tenantId,
        roles: p.roles,
        permissions: p.permissions,
      },
    };
  }
}
