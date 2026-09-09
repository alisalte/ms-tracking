/**
 * Driver Behavior Sprint 1 — event types + score formula (BR-04 / BR-05).
 */

export const DRIVING_EVENT_TYPES = [
  'HARSH_BRAKE',
  'RAPID_ACCELERATION',
  'SPEED_VIOLATION',
  'EXCESSIVE_IDLE',
] as const;

export type DrivingEventType = (typeof DRIVING_EVENT_TYPES)[number];

export interface DrivingEventCounts {
  harshBrake: number;
  rapidAccel: number;
  speedViolation: number;
  excessiveIdle: number;
}

export interface DriverScoreBreakdown extends DrivingEventCounts {
  score: number;
  deductions: {
    harshBrake: number;
    rapidAccel: number;
    speedViolation: number;
    excessiveIdle: number;
  };
}

const DEDUCT = {
  HARSH_BRAKE: 5,
  RAPID_ACCELERATION: 3,
  SPEED_VIOLATION: 4,
  EXCESSIVE_IDLE: 2,
} as const;

const CAP = {
  HARSH_BRAKE: 40,
  RAPID_ACCELERATION: 20,
  SPEED_VIOLATION: 40,
  EXCESSIVE_IDLE: 20,
} as const;

/** Pure score from attributed event counts (higher = safer). */
export function computeDriverScore(counts: DrivingEventCounts): DriverScoreBreakdown {
  const harshBrake = Math.min(counts.harshBrake * DEDUCT.HARSH_BRAKE, CAP.HARSH_BRAKE);
  const rapidAccel = Math.min(counts.rapidAccel * DEDUCT.RAPID_ACCELERATION, CAP.RAPID_ACCELERATION);
  const speedViolation = Math.min(
    counts.speedViolation * DEDUCT.SPEED_VIOLATION,
    CAP.SPEED_VIOLATION,
  );
  const excessiveIdle = Math.min(counts.excessiveIdle * DEDUCT.EXCESSIVE_IDLE, CAP.EXCESSIVE_IDLE);
  const total = harshBrake + rapidAccel + speedViolation + excessiveIdle;
  const score = Math.max(0, Math.min(100, 100 - total));
  return {
    score,
    harshBrake: counts.harshBrake,
    rapidAccel: counts.rapidAccel,
    speedViolation: counts.speedViolation,
    excessiveIdle: counts.excessiveIdle,
    deductions: { harshBrake, rapidAccel, speedViolation, excessiveIdle },
  };
}

/** Map notification.alerts row → behavior event type (or null if not scored). */
export function mapAlarmToDrivingEventType(
  alarmType: string,
  detail: Record<string, unknown> | null | undefined,
): DrivingEventType | null {
  if (alarmType === 'overspeed') return 'SPEED_VIOLATION';
  if (alarmType === 'prolonged_idle') return 'EXCESSIVE_IDLE';
  const code = String(detail?.alarmCode ?? '').toUpperCase();
  if (alarmType === 'collision' || detail?.deviceAlarm === true) {
    if (code === 'BRAKING') return 'HARSH_BRAKE';
    if (code === 'ACCELERATION') return 'RAPID_ACCELERATION';
  }
  if (code === 'BRAKING') return 'HARSH_BRAKE';
  if (code === 'ACCELERATION') return 'RAPID_ACCELERATION';
  if (code === 'OVERSPEED') return 'SPEED_VIOLATION';
  return null;
}

export function emptyCounts(): DrivingEventCounts {
  return { harshBrake: 0, rapidAccel: 0, speedViolation: 0, excessiveIdle: 0 };
}

export function tallyEventType(counts: DrivingEventCounts, type: DrivingEventType): void {
  switch (type) {
    case 'HARSH_BRAKE':
      counts.harshBrake += 1;
      break;
    case 'RAPID_ACCELERATION':
      counts.rapidAccel += 1;
      break;
    case 'SPEED_VIOLATION':
      counts.speedViolation += 1;
      break;
    case 'EXCESSIVE_IDLE':
      counts.excessiveIdle += 1;
      break;
  }
}

export const DEFAULT_SCORE_PERIOD_DAYS = 30;

/** Sprint 2 — managers should review drivers at or below this score. */
export const LOW_SCORE_ATTENTION_THRESHOLD = 70;
