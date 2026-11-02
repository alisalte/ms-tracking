/**
 * Report mailer — sends a scheduled report's CSV as an email attachment.
 *
 * SMTP is resolved per tenant: the tenant's own settings (managed in
 * tenant-admin) win, else the server-wide REPORT_SMTP_* default. With neither,
 * `isEnabled` is false and delivery is reported as SKIPPED (never faked).
 */
import { Logger } from '@nestjs/common';
import type { SecretBox } from '../crypto/secret-box.js';
import type { TenantEmailSettingsRepository } from '../persistence/tenant-email-settings.repository.js';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly pass: string;
  readonly from: string;
}

export interface ReportEmail {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly filename: string;
  readonly csv: string;
}

export interface ReportMailer {
  isEnabled(tenantId: string): Promise<boolean>;
  send(tenantId: string, email: ReportEmail): Promise<void>;
}

export class TenantSmtpReportMailer implements ReportMailer {
  private readonly logger = new Logger(TenantSmtpReportMailer.name);

  constructor(
    private readonly settings: TenantEmailSettingsRepository,
    private readonly secrets: SecretBox,
    private readonly fallback: SmtpConfig | null,
  ) {}

  /** Tenant settings if present (disabled row = no email, no fallback), else the server default. */
  public async resolve(tenantId: string): Promise<SmtpConfig | null> {
    const own = await this.settings.get(tenantId);
    if (own) {
      if (!own.enabled) return null;
      return {
        host: own.host,
        port: own.port,
        secure: own.secure,
        user: own.username ?? '',
        pass: own.passwordEnc ? this.secrets.decrypt(own.passwordEnc) : '',
        from: own.fromAddress,
      };
    }
    return this.fallback;
  }

  public async isEnabled(tenantId: string): Promise<boolean> {
    return (await this.resolve(tenantId)) !== null;
  }

  public async send(tenantId: string, email: ReportEmail): Promise<void> {
    const smtp = await this.resolve(tenantId);
    if (!smtp) throw new Error('SMTP not configured');
    // Dynamic import so the service boots even without nodemailer installed.
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    const info = await transporter.sendMail({
      from: smtp.from,
      to: [...email.to],
      subject: email.subject,
      text: email.text,
      attachments: [
        {
          filename: email.filename,
          // UTF-8 BOM so Excel opens Persian text correctly.
          content: `﻿${email.csv}`,
          contentType: 'text/csv; charset=utf-8',
        },
      ],
    });
    this.logger.log(
      `Report email sent (${info.messageId ?? 'no-id'}) to ${email.to.length} recipient(s)`,
    );
  }
}
