/**
 * API-key use-cases — issue (returns plaintext once) and revoke. Keys are
 * Argon2id-hashed at rest (16_Public-API-Platform.md §8.1). The plaintext
 * follows the `fv_<env>_<secret>` format; only the prefix + hash are stored.
 */
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiKey as ApiKeyClass, NotFoundError } from '../../domain/index.js';
import type { ApiKeyRepository } from '../../infrastructure/persistence/api-key.repository.js';
import type { PasswordHasher } from '../../infrastructure/services/password-hasher.js';
import type { AuditActor, AuditManager } from '../audit/audit-manager.js';
import { buildEventContext } from '../shared/context.js';

export interface CreateApiKeyInput extends Partial<AuditActor> {
  readonly tenantId: string;
  readonly name: string;
  readonly scopes: string[];
  readonly assignedUserId?: string;
  readonly expiresAt?: Date | null;
  readonly env?: string;
  readonly correlationId?: string;
  readonly actorId?: string | null;
}

export interface CreatedApiKey {
  readonly id: string;
  readonly plaintext: string; // shown once
  readonly keyPrefix: string;
}

@Injectable()
export class CreateApiKeyUseCase {
  constructor(
    private readonly apiKeys: ApiKeyRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditManager,
  ) {}

  public async execute(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const env = input.env ?? 'live';
    const secret = randomBytes(24).toString('base64url');
    const plaintext = `fv_${env}_${secret}`;
    const keyPrefix = plaintext.slice(0, 11); // "fv_live_xxxx"
    const keyHash = await this.hasher.hash(plaintext);
    const id = cryptoRandomUuid();
    const ctx = buildEventContext(input.tenantId, 'api_key', input.correlationId);
    const key = ApiKeyClass.create(
      id,
      {
        tenantId: input.tenantId,
        name: input.name,
        keyHash,
        keyPrefix,
        scopes: input.scopes,
        assignedUserId: input.assignedUserId ?? null,
        expiresAt: input.expiresAt ?? null,
      },
      ctx,
    );
    await this.apiKeys.save(key, ctx);
    // Audit — never log the plaintext key; only the id/prefix/scopes.
    await this.audit.record({
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      action: 'iam.apikey.create',
      resourceType: 'api_key',
      resourceId: id,
      permission: 'iam.apikey.create',
      outcome: 'SUCCESS',
      after: { name: key.name, key_prefix: keyPrefix, scopes: key.scopes },
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
    return { id, plaintext, keyPrefix };
  }
}

@Injectable()
export class RevokeApiKeyUseCase {
  constructor(
    private readonly apiKeys: ApiKeyRepository,
    private readonly audit: AuditManager,
  ) {}

  public async execute(
    tenantId: string,
    keyId: string,
    actor?: AuditActor & { actorId?: string | null },
  ): Promise<void> {
    const key = await this.apiKeys.findById(tenantId, keyId);
    if (!key) throw new NotFoundError('API key');
    key.revoke(buildEventContext(tenantId, 'api_key'));
    await this.apiKeys.save(key, buildEventContext(tenantId, 'api_key'));
    await this.audit.record({
      tenantId,
      actorId: actor?.actorId ?? null,
      actorType: actor?.actorId ? 'USER' : 'SYSTEM',
      action: 'iam.apikey.revoke',
      resourceType: 'api_key',
      resourceId: keyId,
      permission: 'iam.apikey.revoke',
      outcome: 'SUCCESS',
      requestId: actor?.requestId ?? null,
      ipAddress: actor?.ipAddress ?? null,
      userAgent: actor?.userAgent ?? null,
    });
  }
}

function cryptoRandomUuid(): string {
  return globalThis.crypto.randomUUID();
}
