/**
 * Mine haul cycles. A service is one loaded trip: the truck enters the origin
 * (pit / shovel), leaves it, then enters the destination (dump). Shovels stay
 * in the origin; the shovel present while the truck is loading is credited.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface Zone {
  readonly kind: 'circle' | 'polygon';
  readonly lat?: number;
  readonly lng?: number;
  readonly radiusM?: number;
  /** [lng, lat] ring. Closed rings are accepted. */
  readonly ring?: ReadonlyArray<readonly [number, number]>;
}

export interface TrackSample {
  readonly at: Date;
  readonly lat: number;
  readonly lng: number;
}

export interface DriverInterval {
  readonly vehicleId: string;
  readonly driverId: string;
  readonly driverName: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export interface HaulCycle {
  readonly vehicleId: string;
  readonly shovelId: string | null;
  readonly driverId: string | null;
  readonly driverName: string | null;
  readonly originEnteredAt: Date;
  readonly originLeftAt: Date;
  readonly destinationEnteredAt: Date;
  readonly loadDwellSec: number;
  readonly travelSec: number;
  readonly durationSec: number;
  readonly distanceM: number;
  readonly shift: string;
}

export interface OpenHaul {
  readonly vehicleId: string;
  readonly phase: 'LOADING' | 'HAULING';
  readonly since: Date;
}

export interface DetectHaulInput {
  readonly trucks: readonly string[];
  /** Ids used as track keys. The one inside the origin during loading is credited. */
  readonly shovels: readonly string[];
  readonly tracks: ReadonlyMap<string, readonly TrackSample[]>;
  readonly origin: Zone;
  readonly destination: Zone;
  readonly drivers: readonly DriverInterval[];
  readonly shiftStartHour: number;
  readonly shiftDurationHours: number;
  readonly timeZone: string;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function zoneContains(lat: number, lng: number, zone: Zone): boolean {
  if (
    zone.kind === 'circle' &&
    typeof zone.lat === 'number' &&
    typeof zone.lng === 'number' &&
    typeof zone.radiusM === 'number'
  ) {
    return haversineMeters(lat, lng, zone.lat, zone.lng) <= zone.radiusM;
  }
  const ring = zone.ring;
  if (!ring || ring.length < 3) return false;
  return pointInRing(lng, lat, ring);
}

/** Shift label for the window that contains `at`, or `off-shift`. */
export function shiftKey(
  at: Date,
  startHour: number,
  durationHours: number,
  timeZone: string,
): string {
  const start = clampHour(startHour);
  const duration = Math.min(24, Math.max(1, Math.floor(durationHours)));
  const parts = localParts(at, timeZone);
  if (duration >= 24) return `${parts.date} ${pad(start)}:00`;
  const end = (start + duration) % 24;
  const crosses = start + duration > 24;
  const hour = parts.hour;
  const inside = crosses ? hour >= start || hour < end : hour >= start && hour < start + duration;
  if (!inside) return 'off-shift';
  const date =
    crosses && hour < end
      ? localParts(new Date(at.getTime() - 86_400_000), timeZone).date
      : parts.date;
  return `${date} ${pad(start)}:00`;
}

export function detectHaulCycles(input: DetectHaulInput): {
  cycles: HaulCycle[];
  open: OpenHaul[];
} {
  const cycles: HaulCycle[] = [];
  const open: OpenHaul[] = [];
  for (const vehicleId of input.trucks) {
    const samples = [...(input.tracks.get(vehicleId) ?? [])].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
    let phase: 'OUT' | 'LOADING' | 'HAULING' = 'OUT';
    let enteredAt: Date | null = null;
    let leftAt: Date | null = null;
    let leg: TrackSample[] = [];

    const reset = () => {
      phase = 'OUT';
      enteredAt = null;
      leftAt = null;
      leg = [];
    };

    for (const sample of samples) {
      const inOrigin = zoneContains(sample.lat, sample.lng, input.origin);
      const inDest = zoneContains(sample.lat, sample.lng, input.destination);
      if (phase === 'OUT') {
        if (inOrigin && !inDest) {
          phase = 'LOADING';
          enteredAt = sample.at;
        }
        continue;
      }
      if (phase === 'LOADING') {
        if (inOrigin) continue;
        if (inDest) continue;
        phase = 'HAULING';
        leftAt = sample.at;
        leg = [sample];
        continue;
      }
      leg.push(sample);
      if (inOrigin && !inDest) {
        phase = 'LOADING';
        enteredAt = sample.at;
        leftAt = null;
        leg = [];
        continue;
      }
      if (inDest && enteredAt && leftAt) {
        const driver = driverAt(input.drivers, vehicleId, enteredAt);
        const shovelId = shovelAt(input, enteredAt, leftAt);
        cycles.push({
          vehicleId,
          shovelId,
          driverId: driver?.driverId ?? null,
          driverName: driver?.driverName ?? null,
          originEnteredAt: enteredAt,
          originLeftAt: leftAt,
          destinationEnteredAt: sample.at,
          loadDwellSec: secondsBetween(enteredAt, leftAt),
          travelSec: secondsBetween(leftAt, sample.at),
          durationSec: secondsBetween(enteredAt, sample.at),
          distanceM: pathDistance(leg),
          shift: shiftKey(
            enteredAt,
            input.shiftStartHour,
            input.shiftDurationHours,
            input.timeZone,
          ),
        });
        reset();
      }
    }

    if (phase === 'LOADING' && enteredAt)
      open.push({ vehicleId, phase: 'LOADING', since: enteredAt });
    if (phase === 'HAULING' && leftAt) open.push({ vehicleId, phase: 'HAULING', since: leftAt });
  }
  return { cycles, open };
}

export function summarizeHauls(cycles: readonly HaulCycle[]): {
  byVehicle: Array<{ vehicleId: string; services: number; distanceM: number; durationSec: number }>;
  byDriverShift: Array<{
    driverId: string;
    driverName: string;
    shift: string;
    services: number;
    distanceM: number;
    durationSec: number;
  }>;
  byShovel: Array<{ shovelId: string; loads: number }>;
} {
  const vehicles = new Map<string, { services: number; distanceM: number; durationSec: number }>();
  const drivers = new Map<
    string,
    {
      driverId: string;
      driverName: string;
      shift: string;
      services: number;
      distanceM: number;
      durationSec: number;
    }
  >();
  const shovels = new Map<string, number>();
  for (const cycle of cycles) {
    const vehicle = vehicles.get(cycle.vehicleId) ?? { services: 0, distanceM: 0, durationSec: 0 };
    vehicle.services += 1;
    vehicle.distanceM += cycle.distanceM;
    vehicle.durationSec += cycle.durationSec;
    vehicles.set(cycle.vehicleId, vehicle);
    if (cycle.driverId) {
      const key = `${cycle.driverId}|${cycle.shift}`;
      const row = drivers.get(key) ?? {
        driverId: cycle.driverId,
        driverName: cycle.driverName ?? cycle.driverId,
        shift: cycle.shift,
        services: 0,
        distanceM: 0,
        durationSec: 0,
      };
      row.services += 1;
      row.distanceM += cycle.distanceM;
      row.durationSec += cycle.durationSec;
      drivers.set(key, row);
    }
    if (cycle.shovelId) shovels.set(cycle.shovelId, (shovels.get(cycle.shovelId) ?? 0) + 1);
  }
  return {
    byVehicle: [...vehicles.entries()].map(([vehicleId, row]) => ({ vehicleId, ...row })),
    byDriverShift: [...drivers.values()],
    byShovel: [...shovels.entries()].map(([shovelId, loads]) => ({ shovelId, loads })),
  };
}

function shovelAt(input: DetectHaulInput, enteredAt: Date, leftAt: Date): string | null {
  const from = enteredAt.getTime() - 120_000;
  const to = leftAt.getTime() + 120_000;
  let best: { id: string; score: number } | null = null;
  for (const shovelId of input.shovels) {
    const samples = input.tracks.get(shovelId) ?? [];
    let hits = 0;
    let nearest = Number.POSITIVE_INFINITY;
    for (const sample of samples) {
      const t = sample.at.getTime();
      if (t < from || t > to) continue;
      if (!zoneContains(sample.lat, sample.lng, input.origin)) continue;
      hits += 1;
      nearest = Math.min(nearest, Math.abs(t - enteredAt.getTime()));
    }
    if (hits === 0) continue;
    const score = hits * 1_000_000 - nearest;
    if (!best || score > best.score) best = { id: shovelId, score };
  }
  return best?.id ?? null;
}

function driverAt(
  drivers: readonly DriverInterval[],
  vehicleId: string,
  at: Date,
): DriverInterval | null {
  const t = at.getTime();
  for (const driver of drivers) {
    if (driver.vehicleId !== vehicleId) continue;
    if (driver.startedAt.getTime() > t) continue;
    if (driver.endedAt && driver.endedAt.getTime() < t) continue;
    return driver;
  }
  return null;
}

function pathDistance(samples: readonly TrackSample[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (!prev || !curr) continue;
    const dt = Math.max((curr.at.getTime() - prev.at.getTime()) / 1000, 1);
    const meters = haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);
    const speedKmh = (meters / 1000 / dt) * 3600;
    if (meters < 1 || speedKmh > 100) continue;
    total += meters;
  }
  return total;
}

function secondsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
}

function pointInRing(
  lng: number,
  lat: number,
  ring: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function localParts(at: Date, timeZone: string): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  const hour = Number(bag.hour ?? '0') % 24;
  return { date: `${bag.year}-${bag.month}-${bag.day}`, hour };
}

function pad(hour: number): string {
  return String(hour).padStart(2, '0');
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  return Math.min(23, Math.max(0, Math.floor(hour)));
}
