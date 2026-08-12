import { type PageRequestDto, pageRequestSchema } from '@fleetvision/auth';
import { type Page, decodeCursor } from '@fleetvision/shared-kernel';
/**
 * API keys controller — issue/list/revoke. The plaintext secret is returned
 * exactly once at creation (16_Public-API-Platform.md §8.1). Base
 * `/api/v1/auth/api-keys`.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { CreateApiKeyUseCase, RevokeApiKeyUseCase } from '../../application/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { ApiKeyRepository } from '../../infrastructure/persistence/api-key.repository.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import { PermissionsGuard, RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';
import { actorFromRequest } from '../shared/request-context.js';
import { ZodValidationPipe } from '../shared/zod-validation.pipe.js';
import { createApiKeySchema } from './auth.dto.js';

@Controller('api/v1/auth/api-keys')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApiKeysController {
  constructor(
    private readonly createUseCase: CreateApiKeyUseCase,
    private readonly revokeUseCase: RevokeApiKeyUseCase,
    private readonly apiKeys: ApiKeyRepository,
  ) {}

  @Get()
  @RequirePermissions('iam.apikey.read')
  public async list(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Req() req: Request,
  ): Promise<
    Page<{
      id: string;
      name: string;
      key_prefix: string;
      scopes: readonly string[];
      status: string;
      expires_at: Date | null;
      last_used_at: Date | null;
    }>
  > {
    const p = getPrincipal(req);
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { createdAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    const result = await this.apiKeys.listPage(p.tenantId, page.limit, cursor);
    return {
      data: result.data.map((k) => ({
        id: k.id as string,
        name: k.name,
        key_prefix: k.keyPrefix,
        scopes: k.scopes,
        status: k.status,
        expires_at: k.expiresAt,
        last_used_at: k.lastUsedAt,
      })),
      nextCursor: result.nextCursor,
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
      ...actorFromRequest(req),
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
    await this.revokeUseCase.execute(p.tenantId, id, actorFromRequest(req));
  }
}
