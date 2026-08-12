/**
 * Session repository — `media.stream_sessions` CRUD (09 §5.2, §7.3).
 * High-churn table: insert on open, update on close. All access is tenant-scoped
 * (withTenantContext) so RLS enforces isolation; the caller passes the session's
 * tenantId (held in the in-memory ActiveSession by StreamManager).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';

const SCHEMA = 'media';
const TABLE = 'stream_sessions';

export class SessionRepository {
  constructor(private readonly knex: Knex) {}

  public async create(input: {
    sessionId: string;
    tenantId: string;
    channelId: string;
    userId: string | null;
    mode: string;
    quality: string;
    streamerPod: string | null;
  }): Promise<void> {
    await withTenantContext(this.knex, input.tenantId, async (trx) => {
      await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .insert({
          session_id: trx.raw('?::uuid', [input.sessionId]),
          tenant_id: trx.raw('?::uuid', [input.tenantId]),
          channel_id: trx.raw('?::uuid', [input.channelId]),
          user_id: input.userId ? trx.raw('?::uuid', [input.userId]) : null,
          mode: input.mode,
          quality: input.quality,
          state: 'CONNECTING',
          streamer_pod: input.streamerPod,
          viewer_count: 0,
        });
    });
  }

  public async close(tenantId: string, sessionId: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('session_id = ?::uuid', [sessionId])
        .update({
          state: 'CLOSED',
          ended_at: trx.fn.now(),
        });
    });
  }

  public async updateViewerCount(
    tenantId: string,
    sessionId: string,
    count: number,
    state: string,
  ): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('session_id = ?::uuid', [sessionId])
        .update({ viewer_count: count, state });
    });
  }
}
