/**
 * Session repository — `media.stream_sessions` CRUD (09 §5.2, §7.3).
 * High-churn table: insert on open, update on close.
 */
import type { Knex } from '@fleetvision/persistence-knex';

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
    await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        session_id: this.knex.raw('?::uuid', [input.sessionId]),
        tenant_id: this.knex.raw('?::uuid', [input.tenantId]),
        channel_id: this.knex.raw('?::uuid', [input.channelId]),
        user_id: input.userId ? this.knex.raw('?::uuid', [input.userId]) : null,
        mode: input.mode,
        quality: input.quality,
        state: 'CONNECTING',
        streamer_pod: input.streamerPod,
        viewer_count: 0,
      });
  }

  /**
   * Close a session. When `tenantId` is supplied (Sprint B), the update is scoped
   * to that tenant — a cross-tenant caller cannot close another tenant's session
   * (0 rows updated). Returns the number of rows updated so callers can map a
   * cross-tenant attempt to 404 (no existence oracle).
   */
  public async close(sessionId: string, tenantId?: string): Promise<number> {
    const query = this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('session_id = ?::uuid', [sessionId]);
    if (tenantId) query.whereRaw('tenant_id = ?::uuid', [tenantId]);
    return query.update({
      state: 'CLOSED',
      ended_at: this.knex.fn.now(),
    });
  }

  public async updateViewerCount(
    sessionId: string,
    count: number,
    state: string,
    tenantId?: string,
  ): Promise<void> {
    const query = this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('session_id = ?::uuid', [sessionId]);
    if (tenantId) query.whereRaw('tenant_id = ?::uuid', [tenantId]);
    await query.update({ viewer_count: count, state });
  }
}
