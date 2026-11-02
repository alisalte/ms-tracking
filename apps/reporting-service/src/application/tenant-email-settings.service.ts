/**
 * Per-tenant SMTP settings for scheduled-report email (platform-operator managed).
 * The password is write-only: stored encrypted, API exposes only `hasPassword`.
 */
import type { SecretBox } from '../infrastructure/crypto/secret-box.js';
import type { ReportMailer, SmtpConfig } from '../infrastructure/mail/report-mailer.js';
import type {
  TenantEmailSettings,
  TenantEmailSettingsRepository,
} from '../infrastructure/persistence/tenant-email-settings.repository.js';

export class TenantEmailSettingsError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'UNAVAILABLE' = 'INVALID_INPUT',
  ) {
    super(message);
    this.name = 'TenantEmailSettingsError';
  }
}

export interface SaveTenantEmailSettingsInput {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  /** Omitted/undefined keeps the stored password; empty string clears it. */
  password?: string;
  fromAddress: string;
}

function toApi(s: TenantEmailSettings) {
  return {
    enabled: s.enabled,
    host: s.host,
    port: s.port,
    secure: s.secure,
    username: s.username,
    hasPassword: s.passwordEnc !== null,
    fromAddress: s.fromAddress,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export class TenantEmailSettingsService {
  constructor(
    private readonly repo: TenantEmailSettingsRepository,
    private readonly secrets: SecretBox,
    private readonly mailer: ReportMailer,
  ) {}

  public async get(tenantId: string) {
    const s = await this.repo.get(tenantId);
    return { settings: s ? toApi(s) : null, encryptionAvailable: this.secrets.available };
  }

  public async save(tenantId: string, actorId: string | null, input: SaveTenantEmailSettingsInput) {
    let passwordEnc: string | null | undefined;
    if (input.password === undefined) passwordEnc = undefined;
    else if (input.password === '') passwordEnc = null;
    else {
      if (!this.secrets.available) {
        throw new TenantEmailSettingsError(
          'Server has no REPORT_SECRETS_KEY — cannot store an SMTP password',
          'UNAVAILABLE',
        );
      }
      passwordEnc = this.secrets.encrypt(input.password);
    }
    const saved = await this.repo.upsert(tenantId, {
      enabled: input.enabled,
      host: input.host.trim(),
      port: input.port,
      secure: input.secure,
      username: input.username?.trim() || null,
      passwordEnc,
      fromAddress: input.fromAddress.trim(),
      updatedBy: actorId,
    });
    return toApi(saved);
  }

  public async remove(tenantId: string): Promise<void> {
    if (!(await this.repo.remove(tenantId))) {
      throw new TenantEmailSettingsError('No email settings for this tenant', 'NOT_FOUND');
    }
  }

  /** Send a test message using the tenant's effective SMTP (own settings, else server default). */
  public async sendTest(tenantId: string, to: string): Promise<void> {
    if (!(await this.mailer.isEnabled(tenantId))) {
      throw new TenantEmailSettingsError('No SMTP configured for this tenant', 'UNAVAILABLE');
    }
    await this.mailer.send(tenantId, {
      to: [to],
      subject: '[FleetVision] SMTP test',
      text: 'This is a test message from FleetVision scheduled-report email settings.',
      filename: 'test.csv',
      csv: 'ok\n',
    });
  }
}

export type { SmtpConfig };
