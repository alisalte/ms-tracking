/**
 * Unit tests for Fleet Health Score v1 formula.
 */
import { describe, expect, it } from 'vitest';

import {
  alarmPenalty,
  computeFleetHealthScore,
  connectivityScore,
  healthScoreTone,
  vehicleHealthScore,
} from '@/lib/fleet-health-score';

describe('fleet-health-score', () => {
  it('maps presence to connectivity', () => {
    expect(connectivityScore('ONLINE')).toBe(100);
    expect(connectivityScore('STALE')).toBe(50);
    expect(connectivityScore('OFFLINE')).toBe(0);
    expect(connectivityScore('UNKNOWN')).toBe(0);
    expect(connectivityScore(undefined)).toBe(0);
  });

  it('caps alarm penalty at 70', () => {
    expect(alarmPenalty(['critical', 'critical'])).toBe(70);
    expect(alarmPenalty(['info'])).toBe(5);
    expect(alarmPenalty(['major', 'minor'])).toBe(30);
  });

  it('weights connectivity 60% and alarms 40%', () => {
    // ONLINE (100) + no alarms → 100
    expect(vehicleHealthScore('ONLINE', []).score).toBe(100);
    // OFFLINE (0) + no alarms → 0.6*0 + 0.4*100 = 40
    expect(vehicleHealthScore('OFFLINE', []).score).toBe(40);
    // ONLINE + one critical (penalty 40) → 0.6*100 + 0.4*60 = 84
    expect(vehicleHealthScore('ONLINE', ['critical']).score).toBe(84);
  });

  it('averages vehicle scores for the fleet', () => {
    const result = computeFleetHealthScore(
      [
        { vehicleId: 'v1', presence: 'ONLINE' },
        { vehicleId: 'v2', presence: 'OFFLINE' },
      ],
      [{ vehicleId: 'v1', severity: 'critical' }],
    );
    // v1=84, v2=40 → mean 62
    expect(result.score).toBe(62);
    expect(result.scoredCount).toBe(2);
    expect(result.attentionCount).toBe(1);
  });

  it('returns null score with no vehicles', () => {
    expect(computeFleetHealthScore([], []).score).toBeNull();
    expect(healthScoreTone(null)).toBe('gray');
    expect(healthScoreTone(90)).toBe('success');
    expect(healthScoreTone(75)).toBe('warning');
    expect(healthScoreTone(50)).toBe('danger');
  });
});
