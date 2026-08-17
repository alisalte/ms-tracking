/**
 * DeviceCommandRepository — maps the DeviceCommand projection to
 * `fleet.device_commands` (02 §3.2; 06 §11.3 SendDeviceCommand).
 *
 * Lifecycle transitions are guarded UPDATEs on (status) so the ack consumer and
 * the TTL sweeper never regress a terminal row (ACKED/FAILED/EXPIRED win).
 *
 * Writes accept a transaction (management path stays atomic with the audit
 * append); Kafka-driven transitions (markSent/markAcked/markFailed) use
 * non-transactional single statements — idempotent on the status guard.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { Page } from '@fleetvision/shared-kernel';
import type {
  DeviceCommandRecord,
  DeviceCommandStatus,
} from '../../domain/device-command/device-command-types.js';
import { listPaginated } from './list-pagination.js';

const SCHEMA = 'fleet';
const TABLE = 'device_commands';

export interface DeviceCommandRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly device_id: string;
  readonly command_code: string;
  readonly category: string;
  readonly params: Record<string, unknown> | null;
  readonly payload_text: string | null;
  readonly payload_hex: string | null;
  readonly status: DeviceCommandStatus;
  readonly response_text: string | null;
  readonly error: string | null;
  readonly issued_by: string | null;
  readonly issued_at: Date;
  readonly sent_at: Date | null;
  readonly acked_at: Date | null;
  readonly expires_at: Date;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface DeviceCommandListFilters {
  readonly deviceId?: string;
  readonly status?: DeviceCommandStatus;
  readonly commandCode?: string;
}

export class DeviceCommandRepository {
  constructor(private readonly knex: Knex) {}

  public async findById(tenantId: string, id: string): Promise<DeviceCommandRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .first();
    return (row as DeviceCommandRow | undefined) ?? null;
  }

  public async list(
    tenantId: string,
    filters: DeviceCommandListFilters,
    opts: { cursor?: string; limit: number },
  ): Promise<Page<DeviceCommandRow>> {
    const base = this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId]);
    if (filters.deviceId) base.whereRaw('device_id = ?::uuid', [filters.deviceId]);
    if (filters.status) base.where('status', filters.status);
    if (filters.commandCode) base.where('command_code', filters.commandCode);
    return listPaginated<DeviceCommandRow>(base, opts);
  }

  public async create(
    trx: Knex.Transaction,
    tenantId: string,
    input: {
      deviceId: string;
      commandCode: string;
      category: string;
      params: Record<string, unknown> | null;
      payloadText: string | null;
      payloadHex: string | null;
      issuedBy: string | null;
      expiresAt: Date;
    },
  ): Promise<DeviceCommandRow> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        tenant_id: trx.raw('?::uuid', [tenantId]),
        device_id: trx.raw('?::uuid', [input.deviceId]),
        command_code: input.commandCode,
        category: input.category,
        params: JSON.stringify(input.params ?? {}),
        payload_text: input.payloadText,
        payload_hex: input.payloadHex,
        issued_by: input.issuedBy ? trx.raw('?::uuid', [input.issuedBy]) : null,
        expires_at: input.expiresAt,
      })
      .returning('*');
    return row as DeviceCommandRow;
  }

  /** QUEUED/SENT → SENT (gateway wrote the frame). Terminal rows untouched. */
  public async markSent(tenantId: string, id: string): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .whereIn('status', ['QUEUED', 'SENT'])
      .update({ status: 'SENT', sent_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
  }

  /** QUEUED/SENT → ACKED with the device's response (D82 body). */
  public async markAcked(tenantId: string, id: string, responseText: string): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .whereIn('status', ['QUEUED', 'SENT'])
      .update({
        status: 'ACKED',
        response_text: responseText,
        error: null,
        // COMMAND_SENT may arrive after the device ack (same topic, two
        // producers) — backfill sent_at so the timeline stays truthful.
        sent_at: this.knex.raw('COALESCE(sent_at, NOW())'),
        acked_at: this.knex.fn.now(),
        updated_at: this.knex.fn.now(),
      });
  }

  /** QUEUED/SENT → FAILED (gateway rejection or device error response). */
  public async markFailed(
    tenantId: string,
    id: string,
    error: string,
    responseText?: string | null,
  ): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .whereIn('status', ['QUEUED', 'SENT'])
      .update({
        status: 'FAILED',
        error,
        ...(responseText !== undefined ? { response_text: responseText } : {}),
        sent_at: this.knex.raw('COALESCE(sent_at, NOW())'),
        acked_at: this.knex.fn.now(),
        updated_at: this.knex.fn.now(),
      });
  }

  /**
   * Latest non-terminal command for (device, code) — the ack-match target.
   * The Meitrack D82 reply carries no command id, only the code (§1.1), so the
   * consumer matches the most recent QUEUED/SENT row for that device+code.
   */
  public async latestPendingByCode(
    tenantId: string,
    deviceId: string,
    commandCode: string,
  ): Promise<DeviceCommandRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('device_id = ?::uuid', [deviceId])
      .where('command_code', commandCode)
      .whereIn('status', ['QUEUED', 'SENT'])
      .orderBy('issued_at', 'desc')
      .first();
    return (row as DeviceCommandRow | undefined) ?? null;
  }

  /** Command lookup by id regardless of terminal state (sent-event correlation). */
  public async findByIdAnyStatus(tenantId: string, id: string): Promise<DeviceCommandRow | null> {
    return this.findById(tenantId, id);
  }

  /** TTL sweeper: QUEUED/SENT past expires_at → EXPIRED. Returns count. */
  public async expireStale(now: Date): Promise<number> {
    return await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereIn('status', ['QUEUED', 'SENT'])
      .where('expires_at', '<', now)
      .update({ status: 'EXPIRED', error: 'TTL_EXPIRED', updated_at: this.knex.fn.now() });
  }

  public static toRecord(row: DeviceCommandRow): DeviceCommandRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      deviceId: row.device_id,
      commandCode: row.command_code,
      category: row.category,
      params: row.params ?? null,
      payloadText: row.payload_text,
      payloadHex: row.payload_hex,
      status: row.status,
      responseText: row.response_text,
      error: row.error,
      issuedBy: row.issued_by,
      issuedAt: new Date(row.issued_at),
      sentAt: row.sent_at ? new Date(row.sent_at) : null,
      ackedAt: row.acked_at ? new Date(row.acked_at) : null,
      expiresAt: new Date(row.expires_at),
      version: row.version,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
