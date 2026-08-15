/**
 * API-key use-cases — issue (returns plaintext once) and revoke. Keys are
 * Argon2id-hashed at rest (16_Public-API-Platform.md §8.1). The plaintext
 * follows the `fv_<env>_<secret>` format; only the prefix + hash are stored.
 *
 * Sprint B: scopes are validated against the creator's own permissions (an API
 * key may never carry a permission its creator does not have) and a wildcard
 * creator (`*`, e.g. tenant-admin) may mint any scope.
 */
import { randomBytes } from 'node:crypto';
import { WILDCARD_PERMISSION, permissionSatisfies } from '@fleetvision/auth';
import { Injectable } from '@nestjs/common';
import { ApiKey as ApiKeyClass, NotFoundError } from '../../domain/index.js';
import type { ApiKeyRepository } from '../../infrastructure/persistence/api-key.repository.js';
import type { PasswordHasher } from '../../infrastructure/services/password-hasher.js';
import { buildEventContext } from '../shared/context.js';

export interface CreateApiKeyInput {
  readonly tenantId: string;
  readonly name: string;
  readonly scopes: string[];
  readonly assignedUserId?: string;
  readonly expiresAt?: Date | null;
  readonly env?: string;
  readonly correlationId?: string;
  /** Creator's resolved permissions — scopes must be a subset (Sprint B). */
  readonly creatorPermissions?: readonly string[];
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
  ) {}

  public async execute(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    // An API key's scopes cannot exceed what the creator is allowed to do.
    this.assertScopesWithin(input.scopes, input.creatorPermissions);

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
    return { id, plaintext, keyPrefix };
  }

  /**
   * Every requested scope must be satisfied by the creator's permissions. A
   * wildcard creator (`*`) may mint any scope. If creator permissions are not
   * supplied (e.g. a platform/bootstrap path), validation is skipped.
   */
  private assertScopesWithin(scopes: readonly string[], creator?: readonly string[]): void {
    if (!creator || creator.length === 0) return;
    for (const scope of scopes) {
      if (scope === WILDCARD_PERMISSION) {
        if (!creator.includes(WILDCARD_PERMISSION)) {
          throw new Error('API key scope exceeds creator permissions.');
        }
        continue;
      }
      if (!permissionSatisfies(creator, scope)) {
        throw new Error('API key scope exceeds creator permissions.');
      }
    }
  }
}

@Injectable()
export class RevokeApiKeyUseCase {
  constructor(private readonly apiKeys: ApiKeyRepository) {}

  public async execute(tenantId: string, keyId: string): Promise<void> {
    const key = await this.apiKeys.findById(tenantId, keyId);
    if (!key) throw new NotFoundError('API key');
    key.revoke(buildEventContext(tenantId, 'api_key'));
    await this.apiKeys.save(key, buildEventContext(tenantId, 'api_key'));
  }
}

function cryptoRandomUuid(): string {
  return globalThis.crypto.randomUUID();
}
