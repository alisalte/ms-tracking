/**
 * API keys controller — issue/list/revoke. The plaintext secret is returned
 * exactly once at creation (16_Public-API-Platform.md §8.1). Base
 * `/api/v1/auth/api-keys`.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { CreateApiKeyUseCase, RevokeApiKeyUseCase } from '../../application/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { ApiKeyRepository } from '../../infrastructure/persistence/api-key.repository.js';
import { RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';
import { ZodValidationPipe } from '../shared/zod-validation.pipe.js';
import { createApiKeySchema } from './auth.dto.js';

/**
 * API keys management. Authentication + RBAC are enforced by the global guards
 * (CompositeAuthGuard + PermissionsGuard); each route declares its permission.
 */
@Controller('api/v1/auth/api-keys')
export class ApiKeysController {
  constructor(
    private readonly createUseCase: CreateApiKeyUseCase,
    private readonly revokeUseCase: RevokeApiKeyUseCase,
    private readonly apiKeys: ApiKeyRepository,
  ) {}

  @Get()
  @RequirePermissions('iam.apikey.read')
  public async list(@Req() req: Request) {
    const p = getPrincipal(req);
    const keys = await this.apiKeys.list(p.tenantId);
    return {
      data: keys.map((k) => ({
        id: k.id as string,
        name: k.name,
        key_prefix: k.keyPrefix,
        scopes: k.scopes,
        status: k.status,
        expires_at: k.expiresAt,
        last_used_at: k.lastUsedAt,
      })),
    };
  }

  @Post()
  @RequirePermissions('iam.apikey.create')
  public async create(
    @Body(new ZodValidationPipe(createApiKeySchema)) body: {
      name: string;
      scopes: string[];
      assigned_user_id?: string | null;
      expires_at?: string | null;
    },
    @Req() req: Request,
  ) {
    const p = getPrincipal(req);
    const created = await this.createUseCase.execute({
      tenantId: p.tenantId,
      name: body.name,
      scopes: body.scopes,
      assignedUserId: body.assigned_user_id ?? undefined,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
      creatorPermissions: p.permissions,
    });
    // Plaintext returned once.
    return {
      data: {
        id: created.id,
        key: created.plaintext,
        key_prefix: created.keyPrefix,
      },
    };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('iam.apikey.revoke')
  public async revoke(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const p = getPrincipal(req);
    await this.revokeUseCase.execute(p.tenantId, id);
  }
}
