/**
 * API key aggregate — a tenant-scoped, role-bound service credential.
 *
 * Invariants (Identity-Access-Management.md §3.3, 16_Public-API-Platform.md §8):
 *   - keyHash is immutable after creation (rotation = new key object).
 *   - at least one scope is required.
 *   - scopes cannot exceed tenant permissions (checked by the application layer).
 *
 * The plaintext secret is returned to the caller exactly once at creation and
 * is never recoverable (only the Argon2id hash is stored).
 */
import { AggregateRoot, type Brand } from '@fleetvision/shared-kernel';
import { ApiKeyCreatedEvent, ApiKeyRevokedEvent, type EventContext } from './events.js';

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED';

export interface ApiKeyProps {
  readonly tenantId: string;
  readonly name: string;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly scopes: string[];
  readonly assignedUserId: string | null;
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly status: ApiKeyStatus;
  readonly ipAllowlist: string[];
}

export class ApiKey extends AggregateRoot<Brand<string, 'ApiKeyId'>> {
  private readonly props: ApiKeyProps;

  private constructor(id: string, version: number, props: ApiKeyProps) {
    super(id as Brand<string, 'ApiKeyId'>, version);
    this.props = { ...props };
  }

  public static create(
    id: string,
    init: {
      tenantId: string;
      name: string;
      keyHash: string;
      keyPrefix: string;
      scopes: string[];
      assignedUserId?: string | null;
      expiresAt?: Date | null;
      ipAllowlist?: string[];
    },
    ctx: EventContext,
  ): ApiKey {
    if (init.scopes.length === 0) {
      throw new Error('API key requires at least one scope.');
    }
    const key = new ApiKey(id, 0, {
      tenantId: init.tenantId,
      name: init.name,
      keyHash: init.keyHash,
      keyPrefix: init.keyPrefix,
      scopes: [...init.scopes],
      assignedUserId: init.assignedUserId ?? null,
      expiresAt: init.expiresAt ?? null,
      lastUsedAt: null,
      status: 'ACTIVE',
      ipAllowlist: init.ipAllowlist ?? [],
    });
    key.raise(new ApiKeyCreatedEvent(key.eventContext(ctx), init.keyPrefix));
    return key;
  }

  public static rehydrate(id: string, version: number, props: ApiKeyProps): ApiKey {
    return new ApiKey(id, version, props);
  }

  public get tenantId(): string {
    return this.props.tenantId;
  }
  public get name(): string {
    return this.props.name;
  }
  public get keyHash(): string {
    return this.props.keyHash;
  }
  public get keyPrefix(): string {
    return this.props.keyPrefix;
  }
  public get scopes(): readonly string[] {
    return this.props.scopes;
  }
  public get assignedUserId(): string | null {
    return this.props.assignedUserId;
  }
  public get expiresAt(): Date | null {
    return this.props.expiresAt;
  }
  public get lastUsedAt(): Date | null {
    return this.props.lastUsedAt;
  }
  public get status(): ApiKeyStatus {
    return this.props.status;
  }
  public get ipAllowlist(): readonly string[] {
    return this.props.ipAllowlist;
  }

  /** @deprecated No API-key verification endpoint wires this yet (Sprint 2). */
  public isActive(): boolean {
    if (this.props.status !== 'ACTIVE') return false;
    if (this.props.expiresAt && this.props.expiresAt <= new Date()) return false;
    return true;
  }

  public revoke(ctx: EventContext): void {
    (this.props as { status: ApiKeyStatus }).status = 'REVOKED';
    this.raise(new ApiKeyRevokedEvent(this.eventContext(ctx)));
  }

  /** @deprecated No API-key verification endpoint stamps last-used yet (Sprint 2). */
  public stampUsed(): void {
    (this.props as { lastUsedAt: Date | null }).lastUsedAt = new Date();
  }

  private eventContext(ctx: EventContext) {
    return {
      tenant_id: ctx.tenantId,
      correlation_id: ctx.correlationId,
      aggregate_id: this.id as string,
      aggregate_type: ctx.aggregateType,
      aggregate_version: this.version,
    };
  }
}
