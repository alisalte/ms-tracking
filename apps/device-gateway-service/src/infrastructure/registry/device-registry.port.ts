/**
 * DeviceRegistry port (06 §7, §11).
 *
 * The gateway references — but does **not** own — the durable TelematicsDevice
 * aggregate (`telemetry.telematics_devices`), which is owned by
 * `device-management-service` (06 §11.2). The gateway resolves IMEI → device
 * identity via this port; in production the implementation is a gRPC client to
 * device-management-service (06 §7.1). Sprint 3 ships an in-memory implementation
 * so the gateway runs end-to-end before that service exists; the gRPC client is
 * a later-sport swap behind this same interface.
 *
 * The auth-resolver (L1 LRU → L2 Redis → L3 registry) calls here only on a cache
 * miss; a miss-at-L3 means the device is unknown → reject and close (06 §7.2).
 */

/** The resolved identity + state of a device, used by the auth stage. */
export interface ResolvedDevice {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly status: DeviceStatus;
  /** Vehicle the device is paired to, if any (06 §11.2 INV-TEL02). */
  readonly pairedVehicleId: string | null;
}

/** Device lifecycle states mirrored from the durable registry (03 §5.2). */
export type DeviceStatus = 'ACTIVE' | 'SUSPENDED' | 'DECOMMISSIONED' | 'UNPAIRED';

/**
 * Resolution result. `found: false` (null device) means the IMEI is unknown;
 * `found: true` carries the identity. The auth-resolver distinguishes unknown
 * (reject unknown) from disabled/decommissioned (reject disabled).
 */
export type Resolution =
  | { readonly found: false }
  | { readonly found: true; readonly device: ResolvedDevice };

export interface TenantStatus {
  readonly tenantId: string;
  /** Tenants are read-only here; the gateway rejects when not ACTIVE. */
  readonly active: boolean;
}

/**
 * The device-registry port. Implementations:
 *   - `InMemoryDeviceRegistry` (this sprint, tests + local dev)
 *   - `GrpcDeviceRegistry` (later sprint — calls device-management-service)
 */
export interface DeviceRegistry {
  /** Resolve an IMEI/serial to a device identity. Miss = unknown device. */
  resolve(serialOrImei: string): Promise<Resolution>;

  /** Whether the owning tenant is active (06 §7.3 — tenant suspended → close). */
  tenantActive(tenantId: string): Promise<boolean>;
}

/**
 * In-memory DeviceRegistry for Sprint 3 — seeded from config/tests. Production
 * replaces this with a gRPC client to device-management-service (06 §7.2 L3).
 */
export class InMemoryDeviceRegistry implements DeviceRegistry {
  private readonly devices = new Map<string, ResolvedDevice>();
  private readonly tenants = new Map<string, boolean>();

  /** Seed a known device + (optionally) its tenant. */
  public register(device: ResolvedDevice, tenantActive = true): this {
    // The registry is keyed by the IMEI/serial the device sends on the wire.
    // Callers seed the same value they expect in the LOGIN frame.
    this.devices.set(device.deviceId, device); // keyed by deviceId; resolve() scans
    this.tenants.set(device.tenantId, tenantActive);
    return this;
  }

  /** Seed by IMEI (the common case — the wire identifier). */
  public registerByImei(imei: string, device: ResolvedDevice, tenantActive = true): this {
    this.devices.set(imei, device);
    this.tenants.set(device.tenantId, tenantActive);
    return this;
  }

  public async resolve(serialOrImei: string): Promise<Resolution> {
    const device = this.devices.get(serialOrImei);
    if (!device) return { found: false };
    return { found: true, device };
  }

  public async tenantActive(tenantId: string): Promise<boolean> {
    return this.tenants.get(tenantId) ?? false;
  }
}
