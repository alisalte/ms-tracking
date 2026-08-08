/**
 * Command Center domain types — typed contract.
 *
 * TODO: The device-gateway-service currently has no command-dispatch REST
 * endpoint (only an internal admin API). These types define the contract for
 * when the backend lands a `POST /devices/:id/commands` endpoint.
 *
 * Source: docs/specs/06_Device_Gateway.md §7 (DeviceCommand aggregate).
 */

/** Command types supported by the JT808/GT06 protocol adapters. */
export type CommandType =
  | 'REQUEST_POSITION'
  | 'REQUEST_STATUS'
  | 'REBOOT'
  | 'CONFIGURATION'
  | 'LOCK'
  | 'UNLOCK'
  | 'ENGINE_CUT'
  | 'ENGINE_RESTORE'
  | 'SET_INTERVAL'
  | 'SET_GEOFENCE'
  | 'OTA_FIRMWARE';

/** Command lifecycle (DeviceCommand aggregate, 06 §7 DeviceCommandStatus). */
export type CommandStatus =
  | 'PENDING'
  | 'SENT'
  | 'ACKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

/** A device command (06 §7 DeviceCommand, UI subset). */
export interface DeviceCommand {
  id: string;
  deviceId: string;
  vehicleId: string;
  vehicleLabel: string;
  type: CommandType;
  status: CommandStatus;
  /** Command parameters (type-specific). */
  params: Record<string, unknown>;
  /** ISO timestamp the command was issued. */
  issuedAt: string;
  /** ISO timestamp the command was acknowledged (if ACKED/COMPLETED). */
  ackedAt?: string;
  /** ISO timestamp the command expired or failed. */
  completedAt?: string;
  /** TTL in seconds (commands expire if unacked). */
  ttlSec: number;
  /** Error message if FAILED. */
  error?: string;
  /** Who issued the command. */
  issuedBy: string;
}
