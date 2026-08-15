/**
 * NotificationDelivery — the delivery audit record for one channel attempt.
 *
 * Lifecycle (Sprint H §6):
 *   PENDING → SENT → DELIVERED (only when the provider confirms delivery)
 *   PENDING → FAILED (retryable → back to PENDING via the durable retry worker)
 *   FAILED (attempts exhausted → terminal FAILED)
 *   SENT → READ (in-app only, when the user reads the notification)
 *
 * SENT means the provider ACCEPTED the message. DELIVERED is recorded only
 * when the provider returns a delivery confirmation — never inferred.
 */
import { randomUUID } from 'node:crypto';
import type { NotificationChannel, NotificationStatus } from './notification-types.js';

export const MAX_DELIVERY_ATTEMPTS = 3;
export const RETRY_BASE_BACKOFF_MS = 2000;

/**
 * Error classification (Sprint H §31):
 * - PERMANENT: invalid recipient/token, provider rejected the request —
 *   never retried, the delivery fails fast.
 * - TRANSIENT: timeout, connection reset, provider 5xx, temporary DB
 *   failure — retried with exponential backoff.
 */
export type DeliveryErrorClass = 'PERMANENT' | 'TRANSIENT';

export class PermanentDeliveryError extends Error {
  public readonly errorClass: DeliveryErrorClass = 'PERMANENT';
  public readonly errorCode: string;
  constructor(message: string, errorCode = 'PERMANENT') {
    super(message);
    this.errorCode = errorCode;
  }
}

export class TransientDeliveryError extends Error {
  public readonly errorClass: DeliveryErrorClass = 'TRANSIENT';
  public readonly errorCode: string;
  constructor(message: string, errorCode = 'TRANSIENT') {
    super(message);
    this.errorCode = errorCode;
  }
}

/** Heuristic classifier for provider failures that were not pre-classified. */
export function classifyDeliveryError(err: unknown): DeliveryErrorClass {
  if (err instanceof PermanentDeliveryError) return 'PERMANENT';
  if (err instanceof TransientDeliveryError) return 'TRANSIENT';
  const message = (err as Error)?.message ?? String(err);
  if (/invalid (email|phone|recipient|token)|rejected|unauthorized|not configured/i.test(message)) {
    return 'PERMANENT';
  }
  if (/timeout|econnreset|econnrefused|etimedout|5\d\d|temporarily|network/i.test(message)) {
    return 'TRANSIENT';
  }
  // Unknown errors are treated as transient so they get bounded retries.
  return 'TRANSIENT';
}

/** Exponential backoff for a retry attempt (2s, 4s, 8s by default). */
export function deliveryBackoffMs(attempts: number, baseMs = RETRY_BASE_BACKOFF_MS): number {
  return baseMs * 2 ** Math.max(0, attempts - 1);
}

export interface NotificationDeliveryProps {
  readonly tenantId: string;
  readonly notificationId: string;
  readonly channel: NotificationChannel;
  status: NotificationStatus;
  attempts: number;
  error: string | null;
  errorCode: string | null;
  readonly provider: string | null;
  readonly providerMessageId: string | null;
  sentAt: Date | null;
  nextAttemptAt: Date | null;
  readonly createdAt: Date;
}

export class NotificationDelivery {
  public readonly tenantId: string;
  public readonly notificationId: string;
  public readonly channel: NotificationChannel;
  public status: NotificationStatus;
  public attempts: number;
  public error: string | null;
  public errorCode: string | null;
  public readonly provider: string | null;
  public providerMessageId: string | null;
  public sentAt: Date | null;
  public nextAttemptAt: Date | null;
  public readonly createdAt: Date;
  public readonly id: string;

  private constructor(id: string, props: NotificationDeliveryProps) {
    this.id = id;
    this.tenantId = props.tenantId;
    this.notificationId = props.notificationId;
    this.channel = props.channel;
    this.status = props.status;
    this.attempts = props.attempts;
    this.error = props.error;
    this.errorCode = props.errorCode;
    this.provider = props.provider;
    this.providerMessageId = props.providerMessageId;
    this.sentAt = props.sentAt;
    this.nextAttemptAt = props.nextAttemptAt;
    this.createdAt = props.createdAt;
  }

  public static create(
    tenantId: string,
    notificationId: string,
    channel: NotificationChannel,
    provider?: string,
  ): NotificationDelivery {
    return new NotificationDelivery(randomUUID(), {
      tenantId,
      notificationId,
      channel,
      status: 'PENDING',
      attempts: 0,
      error: null,
      errorCode: null,
      provider: provider ?? null,
      providerMessageId: null,
      sentAt: null,
      nextAttemptAt: null,
      createdAt: new Date(),
    });
  }

  public static rehydrate(id: string, props: NotificationDeliveryProps): NotificationDelivery {
    return new NotificationDelivery(id, props);
  }

  /** Mark as accepted by the provider (SENT ≠ end-user delivery). */
  public markSent(providerMessageId?: string): void {
    this.status = 'SENT';
    this.sentAt = new Date();
    this.error = null;
    this.errorCode = null;
    this.nextAttemptAt = null;
    if (providerMessageId) this.providerMessageId = providerMessageId;
  }

  /** Mark as DELIVERED — only when the provider confirmed end-user delivery. */
  public markDelivered(): void {
    if (this.status !== 'SENT') return;
    this.status = 'DELIVERED';
  }

  /**
   * Record a failed attempt. Permanent errors exhaust the retry budget
   * immediately; transient errors schedule the next attempt with
   * exponential backoff (bounded by maxAttempts).
   */
  public markFailed(
    error: string,
    errorClass: DeliveryErrorClass,
    maxAttempts = MAX_DELIVERY_ATTEMPTS,
    baseMs = RETRY_BASE_BACKOFF_MS,
  ): Date | null {
    this.attempts += 1;
    this.error = error;
    this.errorCode = errorClass;
    if (errorClass === 'PERMANENT' || this.attempts >= maxAttempts) {
      this.status = 'FAILED';
      this.nextAttemptAt = null;
      return null;
    }
    // Stay/return to PENDING with a scheduled next attempt (durable retry).
    this.status = 'PENDING';
    this.nextAttemptAt = new Date(Date.now() + deliveryBackoffMs(this.attempts, baseMs));
    return this.nextAttemptAt;
  }

  /** Can this delivery be retried? (PENDING with a due next attempt). */
  public canRetry(maxAttempts = MAX_DELIVERY_ATTEMPTS): boolean {
    return this.status === 'PENDING' && this.nextAttemptAt !== null && this.attempts < maxAttempts;
  }

  /** True when the retry worker should pick this delivery up now. */
  public isDue(now = new Date()): boolean {
    return (
      this.status === 'PENDING' &&
      this.nextAttemptAt !== null &&
      this.nextAttemptAt.getTime() <= now.getTime()
    );
  }
}
