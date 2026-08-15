import type {
  Alarm,
  AlarmSeverity,
  AlarmSourceEvent,
  AlarmStatus,
  AlarmType,
} from '@/types/alarm.types';
/**
 * Static mock alarm data — the Alarm Center's single demo data source.
 *
 * Alarms are derived deterministically from the existing mock fleet
 * (`mockMapVehicles`) so vehicle labels/drivers/positions stay consistent with
 * the Map and Dashboard surfaces. Covers all 8 catalog types (§2.1) and all 4
 * lifecycle states (§6.2), spread over the last ~48h. When the
 * `notification-service` alarm endpoints land, `api/alarm.api.ts` swaps these
 * constants for `apiGet` calls + wire→camelCase mapping — the types and UI
 * stay unchanged.
 */
import { mockMapVehicles } from './fleet-data';

/** Tiny deterministic PRNG (mulberry32) — no Math.random so tests are stable. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reverse-geocode-ish sample addresses, cycled deterministically per alarm. */
const SAMPLE_ADDRESSES = [
  'Hemmat Hwy, Tehran',
  'Valiasr St, Tehran',
  'Enqelab Ave, Tehran',
  'Mirdamad Blvd, Tehran',
  'Azadi Sq, Tehran',
  'Resalat Hwy, Tehran',
  'Chamran Expwy, Tehran',
  'Niavaran Blvd, Tehran',
] as const;

/** The 8 catalog types + other (§2.1). */
const TYPES: AlarmType[] = [
  'sos',
  'overspeed',
  'geofence',
  'offline',
  'fuel-theft',
  'temperature',
  'collision',
  'camera',
];

/** Type → default severity (§2.1 routing column, simplified). */
const TYPE_SEVERITY: Record<AlarmType, AlarmSeverity> = {
  sos: 'critical',
  overspeed: 'major',
  geofence: 'major',
  offline: 'major',
  'fuel-theft': 'critical',
  temperature: 'major',
  collision: 'critical',
  camera: 'major',
  other: 'minor',
};

/** Type → human headline + detail generator. */
function alarmText(type: AlarmType, rand: () => number): { message: string; detail: string } {
  switch (type) {
    case 'sos':
      return { message: 'SOS / Panic button', detail: 'Driver triggered panic at this location' };
    case 'overspeed': {
      const speed = 115 + Math.round(rand() * 30);
      return {
        message: `Overspeed ${speed} km/h`,
        detail: `Sustained ${10 + Math.round(rand() * 30)}s over limit`,
      };
    }
    case 'geofence':
      return {
        message: 'Geofence breach',
        detail: `Exited ${['Depot-N', 'Zone-A', 'Yard-3'][Math.floor(rand() * 3)]}`,
      };
    case 'offline': {
      const min = 15 + Math.round(rand() * 90);
      return { message: `Offline ${min} min`, detail: 'No position received within window' };
    }
    case 'fuel-theft': {
      const l = 8 + Math.round(rand() * 40);
      return { message: `Fuel theft (${l} L)`, detail: 'Sudden level drop without transaction' };
    }
    case 'temperature': {
      const temp = rand() > 0.5 ? 9 + Math.round(rand() * 3) : -3 - Math.round(rand() * 4);
      return { message: `Temp excursion ${temp}°C`, detail: 'Outside cold-chain band [2°C, 8°C]' };
    }
    case 'collision':
      return { message: 'Collision detected', detail: 'Accelerometer crash signature' };
    case 'camera':
      return {
        message: ['FCW', 'Distraction', 'No seatbelt'][Math.floor(rand() * 3)],
        detail: 'AI event above severity threshold',
      };
    default:
      return { message: 'Alarm', detail: '' };
  }
}

/** Source-event type per alarm type (§2.1 source column). */
const SOURCE_EVENT_TYPE: Record<AlarmType, string> = {
  sos: 'tracking.sos.triggered.v1',
  overspeed: 'tracking.speed.exceeded.v1',
  geofence: 'tracking.geofence.exited.v1',
  offline: 'tracking.position.stale.v1',
  'fuel-theft': 'fuel.fraud.detected.v1',
  temperature: 'telemetry.temp.excursion.v1',
  collision: 'tracking.collision.detected.v1',
  camera: 'media.ai.alert.v1',
  other: 'tracking.event.v1',
};

/** Build a deterministic alarm set spread over the last ~48h. */
function buildMockAlarms(): Alarm[] {
  const rand = seeded(20260810);
  const now = Date.now();
  const alarms: Alarm[] = [];
  const pool = mockMapVehicles
    .filter((v) => v.state !== 'offline')
    .concat(mockMapVehicles.slice(0, 8));

  for (let i = 0; i < 42; i++) {
    const v = pool[i % pool.length] ?? mockMapVehicles[0];
    const type = TYPES[i % TYPES.length] ?? 'other';
    const severity = TYPE_SEVERITY[type];

    // Status distribution: ~40% raised, ~20% acked, ~15% escalated, ~25% resolved.
    const roll = rand();
    const status: AlarmStatus =
      roll < 0.25 ? 'resolved' : roll < 0.4 ? 'escalated' : roll < 0.6 ? 'acked' : 'raised';

    // Spread over the last ~48h.
    const ageMin = Math.round(rand() * 48 * 60);
    const raisedAt = new Date(now - ageMin * 60_000).toISOString();

    const ackedAt =
      status === 'acked' || status === 'resolved'
        ? new Date(
            new Date(raisedAt).getTime() + (1 + Math.round(rand() * 20)) * 60_000,
          ).toISOString()
        : undefined;
    const resolvedAt =
      status === 'resolved'
        ? new Date(
            new Date(ackedAt ?? raisedAt).getTime() + (5 + Math.round(rand() * 40)) * 60_000,
          ).toISOString()
        : undefined;

    // Escalation step: critical/unacked alarms advance further.
    const escalationStep =
      status === 'raised'
        ? Math.floor(rand() * 2)
        : status === 'escalated'
          ? 1 + Math.floor(rand() * 3)
          : 0;

    const text = alarmText(type, rand);
    const sourceType = SOURCE_EVENT_TYPE[type];

    const sourceEvents: AlarmSourceEvent[] = [
      {
        id: `${v.id}-se-${i}`,
        type: sourceType,
        ts: raisedAt,
        detail: text.message,
      },
    ];
    // Collision/camera/SOS carry an extra linked event.
    if (type === 'collision' || type === 'camera' || type === 'sos') {
      sourceEvents.push({
        id: `${v.id}-se-${i}-b`,
        type: type === 'sos' ? 'tracking.position.reported.v1' : 'tracking.behavior.event.v1',
        ts: new Date(new Date(raisedAt).getTime() - 2000).toISOString(),
        detail: 'Preceding context event',
      });
    }

    alarms.push({
      id: `al-${1000 + i}`,
      type,
      severity,
      status,
      vehicleId: v.id,
      vehicleLabel: v.label,
      driver: v.driver,
      lat: v.lat,
      lng: v.lng,
      address: SAMPLE_ADDRESSES[i % SAMPLE_ADDRESSES.length] ?? SAMPLE_ADDRESSES[0],
      raisedAt,
      ackedAt,
      resolvedAt,
      escalationStep,
      message: text.message,
      detail: text.detail,
      sourceEvents,
      linkedClipId: type === 'collision' || type === 'camera' ? `clip-${v.id}-${i}` : undefined,
      // No trips API yet — never fabricate a linked trip id (Sprint E §22).
      linkedTripId: undefined,
    });
  }

  // Newest first — the default sort for the list view.
  return alarms.sort((a, b) => new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime());
}

export const mockAlarms: Alarm[] = buildMockAlarms();

/** Resolve enriched detail for one alarm (factory, mirrors the detail endpoint). */
export function mockAlarmDetail(id: string): Alarm | undefined {
  return mockAlarms.find((a) => a.id === id);
}
