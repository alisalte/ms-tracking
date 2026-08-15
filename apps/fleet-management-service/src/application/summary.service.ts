/**
 * SummaryService — the dashboard's fleet-wide count aggregate (Sprint E §21).
 *
 * The dashboard needs Total Fleets / Vehicles / Devices without fetching (and
 * counting client-side) every paginated list row. This is the minimal backend
 * aggregation the sprint spec permits: three GROUP BY count queries over the
 * EXISTING fleet/vehicle/device domains — no new business domain, no new
 * writes. Connection state (online/offline/stale) is NOT aggregated here; it
 * lives in gps-engine's tracking.device_status projection and is served by
 * `GET /devices/status` there. The frontend merges the two.
 */
import type { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import type { FleetRepository } from '../infrastructure/persistence/fleet.repository.js';
import type { VehicleRepository } from '../infrastructure/persistence/vehicle.repository.js';

export interface FleetSummary {
  readonly fleets: { readonly active: number; readonly archived: number };
  readonly vehicles: { readonly active: number; readonly archived: number };
  readonly devices: { readonly byStatus: Record<string, number>; readonly total: number };
}

export class SummaryService {
  constructor(
    private readonly fleets: FleetRepository,
    private readonly vehicles: VehicleRepository,
    private readonly devices: DeviceRepository,
  ) {}

  /** Aggregate the tenant's registry counts. Tenant-scoped by the repositories. */
  public async get(tenantId: string): Promise<FleetSummary> {
    const [fleetCounts, vehicleCounts, deviceCounts] = await Promise.all([
      this.fleets.countByStatus(tenantId),
      this.vehicles.countByStatus(tenantId),
      this.devices.countByStatus(tenantId),
    ]);
    return {
      fleets: {
        active: fleetCounts.ACTIVE ?? 0,
        archived: fleetCounts.ARCHIVED ?? 0,
      },
      vehicles: {
        active: vehicleCounts.ACTIVE ?? 0,
        archived: vehicleCounts.ARCHIVED ?? 0,
      },
      devices: {
        byStatus: deviceCounts,
        total: Object.values(deviceCounts).reduce((sum, n) => sum + n, 0),
      },
    };
  }
}
