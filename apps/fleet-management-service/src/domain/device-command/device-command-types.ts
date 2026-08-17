/**
 * Device-command domain types (02 §3.2 DeviceCommand aggregate, projected as a
 * status table; 06 §11.3 SendDeviceCommand).
 *
 * A device command is a downstream configuration/control instruction issued to
 * a device over its live TCP session — e.g. setting the reporting interval
 * (Meitrack A12), drawing a geo-fence (B05), or rebooting (F11). The lifecycle:
 *
 *   QUEUED   — validated + persisted, published to command.request
 *   SENT     — the gateway wrote the frame to the socket
 *   ACKED    — the device replied OK (D82 `A11,OK`)
 *   FAILED   — rejected by the gateway (device offline) or the device errored
 *   EXPIRED  — TTL elapsed with no ack (sweeper)
 */

/** Command lifecycle status (check-constrained in fleet.device_commands). */
export type DeviceCommandStatus = 'QUEUED' | 'SENT' | 'ACKED' | 'FAILED' | 'EXPIRED';

/** Catalog command categories (UI grouping; keys are i18n'd as commands.category.*). */
export const COMMAND_CATEGORIES = [
  'tracking',
  'network',
  'phone',
  'alerts',
  'geofence',
  'device',
  'outputs',
  'rfid',
  'temperature',
  'fuel',
  'tpms',
  'media',
  'system',
  'custom',
] as const;
export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

/** Parameter primitives the dynamic UI form + zod validation are built from. */
export type CommandParamType = 'number' | 'string' | 'enum' | 'boolean';

export interface CommandParamDef {
  readonly key: string;
  /** English label (UI fallback). */
  readonly label: string;
  /** Persian label (UI primary when locale=fa). */
  readonly labelFa: string;
  readonly type: CommandParamType;
  /** number: inclusive bounds; enum: option keys. */
  readonly min?: number;
  readonly max?: number;
  /** string: max accepted length. */
  readonly maxLength?: number;
  /** string: allow commas (comma-separated list params). */
  readonly allowComma?: boolean;
  /** number: reject non-integers (default true; lat/lng allow decimals). */
  readonly integer?: boolean;
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
    readonly labelFa: string;
  }[];
  /** Shown after the label, e.g. 'km/h' / '×10s'. */
  readonly unit?: string;
  readonly required: boolean;
  readonly defaultValue?: string | number | boolean;
  /** English hint (help text). */
  readonly hint?: string;
  readonly hintFa?: string;
}

/** One catalog entry — a single protocol command's metadata + parameter shape. */
export interface CommandDef {
  /** Protocol command code, e.g. 'A12'. */
  readonly code: string;
  readonly name: string;
  readonly nameFa: string;
  readonly category: CommandCategory;
  readonly description: string;
  readonly descriptionFa: string;
  readonly params: readonly CommandParamDef[];
  /** True when the device reply carries data the UI should surface (queries). */
  readonly expectResponse: boolean;
  /** True when sending the bare code (no params) reads back current settings. */
  readonly supportsReadback: boolean;
}

/** Result of building a command's wire payload from validated params. */
export type CommandPayload =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'hex'; readonly hex: string };

/** A persisted device-command record (camelCase domain shape). */
export interface DeviceCommandRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly commandCode: string;
  readonly category: string;
  readonly params: Record<string, unknown> | null;
  readonly payloadText: string | null;
  readonly payloadHex: string | null;
  readonly status: DeviceCommandStatus;
  readonly responseText: string | null;
  readonly error: string | null;
  readonly issuedBy: string | null;
  readonly issuedAt: Date;
  readonly sentAt: Date | null;
  readonly ackedAt: Date | null;
  readonly expiresAt: Date;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The wire envelope published on fleetvision.telemetry.command.request. */
export interface CommandRequestEvent {
  readonly commandId: string;
  readonly deviceId: string;
  readonly tenantId: string;
  readonly protocolId: string;
  readonly commandCode: string;
  readonly payloadText: string | null;
  readonly payloadHex: string | null;
}
