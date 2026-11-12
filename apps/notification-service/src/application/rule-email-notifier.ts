/**
 * RuleEmailNotifier — emails an alarm to the extra recipients configured on
 * the alarm rule that fired.
 *
 * SMTP resolution (same precedence as scheduled-report email):
 *   1. the tenant's own settings (reporting.tenant_email_settings) when present
 *      and enabled; a tenant row with enabled=false means "no email" (no fallback);
 *   2. otherwise the server-wide NOTIF_SMTP_* default;
 *   3. with neither → recorded as a PERMANENT FAILED delivery ("SMTP not configured").
 *
 * Failure isolation: `notify` NEVER throws — a mail problem must not break
 * alarm processing. Every attempt is recorded in notification_deliveries
 * (notification_id = the alarm id; single attempt, no durable retry, because
 * there is no per-user notification row for the retry worker to re-dispatch).
 * Secrets are never logged and never written to the delivery error column.
 */
import { Logger } from '@nestjs/common';
import { NotificationDelivery } from '../domain/notification-delivery.js';
import type { TenantSmtpResult } from '../infrastructure/persistence/tenant-smtp.repository.js';
import type { SmtpConfig } from './channels/channels.js';

export interface RuleEmailMessage {
  readonly tenantId: string;
  /** Alarm occurrence id — recorded as the delivery's notification_id. */
  readonly alarmId: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
}

export interface RuleEmailDeps {
  readonly tenantSmtp: { get(tenantId: string): Promise<TenantSmtpResult> } | null;
  readonly fallback: SmtpConfig | null;
  readonly deliveries: {
    create(d: NotificationDelivery): Promise<void>;
    updateStatus(d: NotificationDelivery): Promise<void>;
  };
  /** Sends one mail; resolves with the provider message id. Injectable for tests. */
  readonly send?: (smtp: SmtpConfig, msg: RuleEmailMessage) => Promise<string | undefined>;
}

const MAX_ERROR_LEN = 300;

async function sendViaNodemailer(
  smtp: SmtpConfig,
  msg: RuleEmailMessage,
): Promise<string | undefined> {
  // Dynamic import so the service boots even without nodemailer installed.
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? false,
    auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  const info = await transporter.sendMail({
    from: smtp.from,
    to: [...msg.to],
    subject: msg.subject,
    text: msg.text,
  });
  return info.messageId ?? undefined;
}

export class RuleEmailNotifier {
  private readonly logger = new Logger('RuleEmailNotifier');

  constructor(private readonly deps: RuleEmailDeps) {}

  /** Resolve SMTP: tenant settings win, else the server default. null = not configured. */
  public async resolveSmtp(tenantId: string): Promise<SmtpConfig | null> {
    if (this.deps.tenantSmtp) {
      try {
        const own = await this.deps.tenantSmtp.get(tenantId);
        if (own.kind === 'tenant') return own.config;
        if (own.kind === 'disabled') return null;
      } catch (err) {
        // Unreadable/undecryptable tenant settings: use the server default
        // rather than silently dropping the alarm mail.
        this.logger.warn(
          `Tenant SMTP unavailable for tenant ${tenantId}, using server default: ${this.safeError(err)}`,
        );
      }
    }
    return this.deps.fallback;
  }

  public async notify(msg: RuleEmailMessage): Promise<void> {
    if (msg.to.length === 0) return;
    try {
      const delivery = NotificationDelivery.create(msg.tenantId, msg.alarmId, 'email', 'smtp');
      await this.deps.deliveries.create(delivery);
      let smtp: SmtpConfig | null = null;
      try {
        smtp = await this.resolveSmtp(msg.tenantId);
        if (!smtp) {
          delivery.markFailed('SMTP not configured', 'PERMANENT', 1);
        } else {
          const id = await (this.deps.send ?? sendViaNodemailer)(smtp, msg);
          delivery.markSent(id);
        }
      } catch (err) {
        delivery.markFailed(this.safeError(err, smtp), 'TRANSIENT', 1);
        this.logger.warn(
          `Rule email for alarm ${msg.alarmId} failed (tenant ${msg.tenantId}): ${delivery.error}`,
        );
      }
      await this.deps.deliveries.updateStatus(delivery);
    } catch (err) {
      // Even recording the attempt failed — still must not break alarm processing.
      this.logger.error(
        `Rule email bookkeeping failed for alarm ${msg.alarmId}: ${this.safeError(err)}`,
      );
    }
  }

  /** Error text with the SMTP password redacted and length bounded. */
  private safeError(err: unknown, smtp?: SmtpConfig | null): string {
    let text = (err as Error)?.message ?? String(err);
    const pass = smtp?.pass ?? this.deps.fallback?.pass;
    if (pass) text = text.split(pass).join('***');
    return text.slice(0, MAX_ERROR_LEN);
  }
}
