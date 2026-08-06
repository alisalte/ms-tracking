/**
 * Device status — the online/offline/stale projection derived from the
 * device-gateway's `telemetry.session.lifecycle.v1` events (06 §12.1).
 *
 * The gateway is the source of truth for connection + data liveness; the GPS
 * engine only projects the gateway's state transitions into a queryable record
 * (07 §13 does not define this table — it is a new tracking-schema projection).
 */
export type DeviceState = 'ONLINE' | 'OFFLINE' | 'STALE';

export interface DeviceStatusRecordProps {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly state: DeviceState;
  readonly protocolId: string | null;
  readonly reason: string | null;
  readonly lastSeenAt: Date;
}

export class DeviceStatusRecord {
  public readonly deviceId: string;
  public readonly tenantId: string;
  public readonly state: DeviceState;
  public readonly protocolId: string | null;
  public readonly reason: string | null;
  public readonly lastSeenAt: Date;

  constructor(props: DeviceStatusRecordProps) {
    this.deviceId = props.deviceId;
    this.tenantId = props.tenantId;
    this.state = props.state;
    this.protocolId = props.protocolId;
    this.reason = props.reason;
    this.lastSeenAt = props.lastSeenAt;
  }
}

/**
 * Map a gateway session-lifecycle `state` string onto a canonical DeviceState.
 * Gateway states (06 §6.1): AUTHENTICATED → ONLINE; DISCONNECTED/CLOSED → OFFLINE;
 * STALE / data-stale → STALE. Unknown states default to OFFLINE (fail-safe).
 */
export function mapSessionState(gatewayState: string): DeviceState {
  const upper = gatewayState.toUpperCase();
  if (upper === 'AUTHENTICATED' || upper === 'ACTIVE' || upper === 'IDENTIFY') {
    return 'ONLINE';
  }
  if (upper.includes('STALE')) {
    return 'STALE';
  }
  return 'OFFLINE';
}
