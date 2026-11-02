/**
 * Persistence for reporting.tenant_email_settings (per-tenant SMTP).
 * The encrypted password never leaves this layer except via `getWithSecret`.
 */
import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';

interface Row {
  tenant_id: string;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password_enc: string | null;
  from_address: string;
  updated_at: Date | string;
}

export interface TenantEmailSettings {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string | null;
  readonly passwordEnc: string | null;
  readonly fromAddress: string;
  readonly updatedAt: Date;
}

export interface UpsertTenantEmailSettings {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string | null;
  /** undefined = keep the stored password; null = clear it; string = new encrypted value. */
  readonly passwordEnc: string | null | undefined;
  readonly fromAddress: string;
  readonly updatedBy: string | null;
}

function map(r: Row): TenantEmailSettings {
  return {
    enabled: r.enabled,
    host: r.host,
    port: r.port,
    secure: r.secure,
    username: r.username,
    passwordEnc: r.password_enc,
    fromAddress: r.from_address,
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
  };
}

export class TenantEmailSettingsRepository {
  constructor(private readonly knex: Knex) {}

  public async get(tenantId: string): Promise<TenantEmailSettings | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx('reporting.tenant_email_settings')
        .where({ tenant_id: tenantId })
        .first<Row>();
      return row ? map(row) : null;
    });
  }

  public async upsert(
    tenantId: string,
    input: UpsertTenantEmailSettings,
  ): Promise<TenantEmailSettings> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const values: Record<string, unknown> = {
        tenant_id: tenantId,
        enabled: input.enabled,
        host: input.host,
        port: input.port,
        secure: input.secure,
        username: input.username,
        from_address: input.fromAddress,
        updated_by: input.updatedBy,
        updated_at: trx.fn.now(),
      };
      if (input.passwordEnc !== undefined) values.password_enc = input.passwordEnc;
      const [row] = await trx('reporting.tenant_email_settings')
        .insert(values)
        .onConflict('tenant_id')
        .merge()
        .returning<Row[]>('*');
      if (!row) throw new Error('Failed to save tenant email settings');
      return map(row);
    });
  }

  public async remove(tenantId: string): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const n = await trx('reporting.tenant_email_settings')
        .where({ tenant_id: tenantId })
        .delete();
      return n > 0;
    });
  }
}
