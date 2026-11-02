/**
 * Read-only access to reporting.tenant_email_settings (per-tenant SMTP).
 *
 * The table is owned and written by reporting-service (tenant-admin "Report
 * email"); notification-service only reads it so alarm-rule email can reuse the
 * tenant's own SMTP. Reads run in platform context (cross-service, system
 * process). The decrypted password lives only inside the returned SmtpConfig —
 * callers must never log or serialize it.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withPlatformContext } from '@fleetvision/persistence-knex';
import type { SmtpConfig } from '../../application/channels/channels.js';
import type { SecretBox } from '../crypto/secret-box.js';

interface Row {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password_enc: string | null;
  from_address: string;
}

export type TenantSmtpResult =
  /** Tenant row exists and is enabled. */
  | { readonly kind: 'tenant'; readonly config: SmtpConfig }
  /** Tenant explicitly disabled email — no fallback. */
  | { readonly kind: 'disabled' }
  /** No tenant row — caller falls back to the server-wide SMTP. */
  | { readonly kind: 'none' };

export class TenantSmtpRepository {
  constructor(
    private readonly knex: Knex,
    private readonly secrets: SecretBox,
  ) {}

  public async get(tenantId: string): Promise<TenantSmtpResult> {
    const row = await withPlatformContext(this.knex, (trx) =>
      trx('reporting.tenant_email_settings').where({ tenant_id: tenantId }).first<Row>(),
    );
    if (!row) return { kind: 'none' };
    if (!row.enabled) return { kind: 'disabled' };
    let pass = '';
    if (row.password_enc) {
      // Decrypt failure (wrong key / corrupt value) throws a generic error —
      // never include the ciphertext or key in the message.
      try {
        pass = this.secrets.decrypt(row.password_enc);
      } catch {
        throw new Error('Tenant SMTP password could not be decrypted (check REPORT_SECRETS_KEY)');
      }
    }
    return {
      kind: 'tenant',
      config: {
        host: row.host,
        port: row.port,
        secure: row.secure,
        user: row.username ?? '',
        pass,
        from: row.from_address,
      },
    };
  }
}
