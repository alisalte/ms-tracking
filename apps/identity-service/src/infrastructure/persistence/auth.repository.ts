/**
 * Auth repository — persists refresh-token families, individual refresh tokens,
 * and auth sessions (the durable forensic mirror of Redis sessions). The hot
 * path reads Redis; this is the system of record.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { PLATFORM_KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { Inject } from '@nestjs/common';
import {
  type EventContext,
  RefreshTokenFamily as FamilyClass,
  type RefreshTokenFamily,
  type RefreshTokenFamilyProps,
  type RefreshTokenRecord,
} from '../../domain/index.js';
import { withPlatformContext, withTenantContext } from './tenant-context.js';

export interface AuthSessionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  status: string;
  auth_provider: string;
  aal: number;
  ip_address: string | null;
  user_agent: string | null;
  refresh_token_family_id: string | null;
  issued_at: Date;
  last_seen_at: Date | null;
  absolute_expires_at: Date;
  revoked_reason: string | null;
  version: number;
}

export interface RefreshTokenRow {
  jti: string;
  family_id: string;
  token_hash: string;
  issued_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

export class AuthRepository {
  constructor(
    private readonly knex: Knex,
    @Inject(PLATFORM_KNEX_TOKEN) private readonly platformKnex: Knex,
  ) {}

  // --- Sessions -------------------------------------------------------------

  public async createSession(row: Omit<AuthSessionRow, 'version'>): Promise<void> {
    await withTenantContext(this.knex, row.tenant_id, async (trx) => {
      await trx('iam.auth_sessions').insert({ ...row, version: 1 });
    });
  }

  public async revokeSession(tenantId: string, sessionId: string, reason: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('iam.auth_sessions')
        .where({ id: sessionId, tenant_id: tenantId })
        .update({ status: 'REVOKED', revoked_reason: reason });
    });
  }

  public async revokeAllUserSessions(
    tenantId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('iam.auth_sessions')
        .where({ tenant_id: tenantId, user_id: userId, status: 'ACTIVE' })
        .update({ status: 'REVOKED', revoked_reason: reason });
    });
  }

  /**
   * Touch a session's last_seen_at on each authenticated request (best-effort
   * — the durable PG mirror stays fresh for forensics instead of going stale at
   * login). Returns the session row so the guard can re-validate status.
   */
  public async touchSession(tenantId: string, sessionId: string): Promise<AuthSessionRow | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('iam.auth_sessions')
        .where({ id: sessionId, tenant_id: tenantId })
        .update({ last_seen_at: new Date() });
      const row = (await trx('iam.auth_sessions')
        .where({ id: sessionId, tenant_id: tenantId })
        .first()) as AuthSessionRow | undefined;
      return row ?? null;
    });
  }

  // --- Refresh token families ----------------------------------------------

  /**
   * Save a family + its tokens. Events drained to the outbox atomically.
   * Rehydrating an existing family for consume is done via `findFamilyByTokenHash`.
   */
  public async saveFamily(family: RefreshTokenFamily, ctx: EventContext): Promise<void> {
    const events = family.pullEvents();
    const tenantId = family.tenantId;
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('iam.refresh_token_families')
        .insert({
          id: family.id as string,
          tenant_id: tenantId,
          user_id: family.userId,
          session_id: family.sessionId,
          status: family.status,
        })
        .onConflict('id')
        .merge(['status']);

      for (const record of family.tokenRecords) {
        await trx('iam.refresh_tokens')
          .insert({
            jti: record.jti,
            family_id: family.id as string,
            token_hash: record.tokenHash,
            expires_at: record.expiresAt,
            consumed_at: record.consumedAt,
            revoked_at: record.revokedAt,
            revoked_reason: record.revokedReason,
          })
          .onConflict('jti')
          .merge();
      }

      if (events.length > 0) {
        await trx('event_outbox').insert(
          events.map((e) => ({
            aggregate_type: ctx.aggregateType,
            aggregate_id: family.id as string,
            tenant_id: tenantId,
            event_type: e.type,
            payload: JSON.stringify({ id: e.id, type: e.type, source: e.source, time: e.time }),
            headers: JSON.stringify({ correlation_id: ctx.correlationId }),
          })),
        );
      }
    });
    family.markEventsCommitted();
  }

  /** Rehydrate a family from its tokens (for the consume/refresh path). */
  public async findFamilyByTokenHash(tokenHash: string): Promise<RefreshTokenFamily | null> {
    // Cross-tenant lookup (a refresh token uniquely identifies a user/family
    // regardless of tenant) — runs on the platform client under platform scope.
    return withPlatformContext(this.platformKnex, async (trx) => {
      const tokenRow = (await trx('iam.refresh_tokens').where({ token_hash: tokenHash }).first()) as
        | RefreshTokenRow
        | undefined;
      if (!tokenRow) return null;
      const familyRow = (await trx('iam.refresh_token_families')
        .where({ id: tokenRow.family_id })
        .first()) as
        | { id: string; tenant_id: string; user_id: string; session_id: string; status: string }
        | undefined;
      if (!familyRow) return null;

      const tokenRows = (await trx('iam.refresh_tokens').where({
        family_id: tokenRow.family_id,
      })) as RefreshTokenRow[];
      const tokens = new Map<string, RefreshTokenRecord>();
      for (const t of tokenRows) {
        tokens.set(t.token_hash, {
          jti: t.jti,
          tokenHash: t.token_hash,
          expiresAt: t.expires_at,
          consumedAt: t.consumed_at,
          revokedAt: t.revoked_at,
          revokedReason: t.revoked_reason,
        });
      }
      const props: RefreshTokenFamilyProps = {
        tenantId: familyRow.tenant_id,
        userId: familyRow.user_id,
        sessionId: familyRow.session_id,
        status: familyRow.status as RefreshTokenFamilyProps['status'],
        tokens,
      };
      return FamilyClass.rehydrate(familyRow.id, 0, props);
    });
  }
}
