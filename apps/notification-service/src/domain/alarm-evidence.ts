/**
 * Alarm evidence domain (F-07 — platform photo + video recipe).
 */

export const EVIDENCE_STATUSES = [
  'PENDING',
  'FETCHING',
  'PHOTO_READY',
  'PHOTO_MISSING',
  'PHOTO_FAILED',
  'SKIPPED_COOLDOWN',
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const VIDEO_STATUSES = ['PENDING', 'FETCHING', 'READY', 'FAILED', 'SKIPPED'] as const;
export type VideoEvidenceStatus = (typeof VIDEO_STATUSES)[number];

export const EVIDENCE_COOLDOWN_MS = 60_000;
export const EVIDENCE_RETENTION_DAYS = 30;

/** Default cabin/driver channel on MD300 when photoName has no _CHn_ tag. */
export const DEFAULT_CABIN_CHANNEL = 2;

export interface AlarmEvidenceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly alertId: string;
  readonly deviceId: string;
  readonly vehicleId: string | null;
  readonly alarmType: string;
  readonly status: EvidenceStatus;
  readonly photoName: string | null;
  readonly photoBytes: Buffer | null;
  readonly photoContentType: string | null;
  readonly commandId: string | null;
  readonly error: string | null;
  readonly videoWindowFrom: Date | null;
  readonly videoWindowTo: Date | null;
  readonly videoObjectKey: string | null;
  readonly videoStatus: VideoEvidenceStatus | null;
  readonly videoChannel: number | null;
  readonly videoCommandId: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function isDmsOrAdasAlarmCode(code: string): boolean {
  const c = code.toUpperCase();
  return c.startsWith('DMS_') || c.startsWith('ADAS_') || c.startsWith('FATIGUE');
}

export function computeEvidenceExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Cabin clip window: 5 s before + 10 s after. */
export function computeVideoWindow(raisedAt: Date): { from: Date; to: Date } {
  return {
    from: new Date(raisedAt.getTime() - 5_000),
    to: new Date(raisedAt.getTime() + 10_000),
  };
}

export function extractPhotoName(detail: Record<string, unknown> | null): string | null {
  if (!detail) return null;
  const direct = detail.photoName;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const nested = detail.lastDetection;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return extractPhotoName(nested as Record<string, unknown>);
  }
  return null;
}

/** Parse `_CH2_` style channel from Meitrack event filenames. */
export function extractCabinChannel(photoName: string | null): number {
  if (photoName) {
    const m = /_CH(\d+)_/i.exec(photoName);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 64) return n;
    }
  }
  return DEFAULT_CABIN_CHANNEL;
}

/** YYMMDDHHMMSS in UTC for AB4 start/end. */
export function toMdvrBcdUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}
