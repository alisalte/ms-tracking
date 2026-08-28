/**
 * Command Center domain types — typed contract with fleet-management-service
 * device-commands API (06 §11.3 SendDeviceCommand; Meitrack MDVR GPRS
 * Protocol V2.0 command catalog).
 *
 *   GET  /device-commands/catalog            → CommandDef[] (form source)
 *   GET  /device-commands/:id                → DeviceCommandRecord
 *   POST /devices/:id/commands               → DeviceCommandRecord (QUEUED)
 *   GET  /devices/:id/commands               → Page<DeviceCommandRecord>
 */

/** Command lifecycle (fleet.device_commands status check constraint). */
export type CommandStatus = 'QUEUED' | 'SENT' | 'ACKED' | 'FAILED' | 'EXPIRED';

/** Catalog categories (mirrors fleet-management COMMAND_CATEGORIES). */
export type CommandCategory =
  | 'tracking'
  | 'network'
  | 'phone'
  | 'alerts'
  | 'geofence'
  | 'device'
  | 'outputs'
  | 'rfid'
  | 'temperature'
  | 'fuel'
  | 'tpms'
  | 'media'
  | 'system'
  | 'custom';

/** Parameter primitives the dynamic form is rendered from. */
export type CommandParamType = 'number' | 'string' | 'enum' | 'boolean';

export interface CommandParamOption {
  readonly value: string;
  readonly label: string;
  readonly labelFa: string;
}

export interface CommandParamDef {
  readonly key: string;
  readonly label: string;
  readonly labelFa: string;
  readonly type: CommandParamType;
  readonly min?: number;
  readonly max?: number;
  readonly maxLength?: number;
  readonly integer?: boolean;
  readonly options?: readonly CommandParamOption[];
  readonly unit?: string;
  readonly required: boolean;
  readonly defaultValue?: string | number | boolean;
  readonly hint?: string;
  readonly hintFa?: string;
  readonly allowComma?: boolean;
}

/** One catalog command — code + names + category + parameter shape. */
export interface CommandDef {
  readonly code: string;
  readonly name: string;
  readonly nameFa: string;
  readonly category: CommandCategory;
  readonly description: string;
  readonly descriptionFa: string;
  readonly params: readonly CommandParamDef[];
  readonly expectResponse: boolean;
  readonly supportsReadback: boolean;
}

/** A persisted device-command record (camelCase, ISO date strings on the wire). */
export interface DeviceCommandRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly commandCode: string;
  readonly category: string;
  readonly params: Record<string, unknown> | null;
  readonly payloadText: string | null;
  readonly payloadHex: string | null;
  readonly status: CommandStatus;
  readonly responseText: string | null;
  readonly error: string | null;
  readonly issuedBy: string | null;
  readonly issuedAt: string;
  readonly sentAt: string | null;
  readonly ackedAt: string | null;
  readonly expiresAt: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** POST /devices/:id/commands body. */
export interface SendCommandPayload {
  readonly commandCode: string;
  readonly params?: Record<string, string | number | boolean>;
  readonly ttlSec?: number;
}

/** POST /device-commands/bulk — one command applied to many devices. */
export interface BulkSendCommandPayload extends SendCommandPayload {
  readonly deviceIds: readonly string[];
}

export interface BulkCommandFailure {
  readonly deviceId: string;
  readonly error: string;
}

export interface BulkCommandResult {
  readonly queued: readonly DeviceCommandRecord[];
  readonly failed: readonly BulkCommandFailure[];
}

/** Status → badge tone (single source for history table chips). */
export const COMMAND_STATUS_TONE: Record<CommandStatus, string> = {
  QUEUED: '#94622e',
  SENT: '#2563eb',
  ACKED: '#15803d',
  FAILED: '#b91c1c',
  EXPIRED: '#6b7280',
};
