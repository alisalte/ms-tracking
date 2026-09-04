import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';
import type { Page } from '@fleetvision/shared-kernel';
/**
 * DeviceCommandService — downstream device-command use-cases (02 §3.2
 * DeviceCommand; 06 §11.3 SendDeviceCommand).
 *
 * `create` runs the full validated pipeline:
 *   device checks (exists, ACTIVE, protocol=meitrack — the MDVR command set)
 *     → catalog validation (validateParams)
 *     → payload build (ASCII text or binary media struct)
 *     → INSERT (QUEUED) + audit inside one tenant transaction
 *     → Kafka publish command.request
 *     → respond with the QUEUED record (SENT/ACKED arrive asynchronously via
 *       the command-ack consumer and are visible to the polling UI).
 *
 * The TTL sweeper (`startSweeper`, wired at module boot) expires unacked
 * commands past their deadline — "TTL enforced; expires if unacked" (02 §3.2).
 */
import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CommandDef,
  CommandPayload,
  DeviceCommandRecord,
} from '../domain/device-command/device-command-types.js';
import {
  CommandValidationError,
  MEITRACK_COMMAND_CATALOG,
  buildPayload,
  getCommandDef,
  validateParams,
} from '../domain/device-command/meitrack-command-catalog.js';
import type { CommandRequestProducer } from '../infrastructure/kafka/command-request-producer.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import {
  type DeviceCommandListFilters,
  DeviceCommandRepository,
} from '../infrastructure/persistence/device-command.repository.js';
import type { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import type { ActorContext } from './service-context.js';
import type {
  BulkCreateDeviceCommandInput,
  CreateDeviceCommandInput,
} from './validation/schemas.js';

export interface BulkCommandFailure {
  readonly deviceId: string;
  readonly error: string;
}

export interface BulkCommandResult {
  readonly queued: DeviceCommandRecord[];
  readonly failed: BulkCommandFailure[];
}

export interface DeviceCommandServiceOptions {
  /** Default TTL (seconds) applied when the request doesn't override it. */
  readonly defaultTtlSeconds: number;
  /** TTL sweeper interval (seconds). */
  readonly sweepIntervalSeconds: number;
  /** Advertised host for A9A/A9D dialback and AB2/AB4 RTMP (rewrites localhost). */
  readonly mdvrPublicHost?: string;
  readonly mdvrPublicPort?: number;
  readonly mdvrRtmpPort?: number;
  /** md300-main `RTMP_STREAM_PATH` (default `live/md300`). */
  readonly mdvrRtmpPath?: string;
}

const LOOPBACK_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', '0.0.0.0']);

function isLoopbackHost(server: string): boolean {
  return LOOPBACK_HOSTS.has(server.trim().toLowerCase());
}

function rewriteRtmpUrl(url: string, host: string, port: number, streamPath?: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = host;
    parsed.port = String(port);
    if (streamPath) {
      const path = streamPath.replace(/^\/+/, '');
      parsed.pathname = `/${path}`;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** `live/md300/2` live; AB4 URL is `live/md300/2/pb` (device still publishes the live key). */
function mdvrChannelStreamPath(
  base: string,
  channel: unknown,
  kind: 'live' | 'playback' = 'live',
): string {
  const root = (base || 'live/md300').replace(/^\/+|\/+$/g, '');
  const n = Number(channel);
  const ch = Number.isInteger(n) && n >= 1 && n <= 129 ? n : 1;
  return kind === 'playback' ? `${root}/${ch}/pb` : `${root}/${ch}`;
}

export class DeviceCommandService {
  private readonly logger = new Logger(DeviceCommandService.name);
  private sweepTimer: NodeJS.Timeout | null = null;
  /** Debounce auto-AB2 per device (md300 sends once per GPRS session). */
  private readonly autoAb2At = new Map<string, number>();

  constructor(
    private readonly knex: Knex,
    private readonly devices: DeviceRepository,
    private readonly commands: DeviceCommandRepository,
    private readonly audit: AuditRepository,
    private readonly producer: CommandRequestProducer | null,
    private readonly options: DeviceCommandServiceOptions,
  ) {
    if (options.mdvrPublicHost) {
      this.logger.log(
        `MDVR AB2 RTMP: rtmp://${options.mdvrPublicHost}:${options.mdvrRtmpPort ?? 1935}/${options.mdvrRtmpPath ?? 'live/md300'}/{channel}`,
      );
    } else {
      this.logger.warn(
        'MDVR public host could not be resolved at boot (MDVR_PUBLIC_HOST unset and ipify ' +
          'lookup failed) — auto-AB2-on-connect and dashboard-triggered AB2/A9A rewrite are ' +
          'disabled until this service restarts. Set MDVR_PUBLIC_HOST explicitly or check ' +
          'outbound internet access from this container.',
      );
    }
  }

  // --- Catalog (UI form source of truth) ------------------------------------

  /** The full command catalog (grouped client-side by category). */
  public catalog(): readonly CommandDef[] {
    return MEITRACK_COMMAND_CATALOG;
  }

  // --- Management API --------------------------------------------------------

  public async create(
    ctx: ActorContext,
    deviceId: string,
    input: CreateDeviceCommandInput,
  ): Promise<DeviceCommandRecord> {
    const def = getCommandDef(input.commandCode);
    if (!def) {
      throw new BadRequestException(`Unknown command code '${input.commandCode}'.`);
    }

    const deviceRow = await this.devices.findById(ctx.tenantId, deviceId);
    if (!deviceRow) throw new NotFoundException('Device not found.');
    if (deviceRow.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Device is ${deviceRow.status} — commands require an ACTIVE device.`,
      );
    }
    if (deviceRow.protocol !== 'meitrack') {
      throw new BadRequestException(
        `Device protocol '${deviceRow.protocol}' does not support the Meitrack MDVR command set.`,
      );
    }

    let validated: Record<string, string | number>;
    let payload: CommandPayload;
    try {
      validated = validateParams(def, this.resolveMediaDialback(def.code, input.params ?? {}));
      payload = buildPayload(def, validated);
    } catch (err) {
      if (err instanceof CommandValidationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const ttl = input.ttlSec ?? this.options.defaultTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    // Persist first (QUEUED) — a Kafka failure must not orphan a published
    // command, but the INSERT also only commits before publish; on publish
    // failure the whole request fails (503) and the sweeper cleans the row.
    const record = await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const row = await this.commands.create(trx, ctx.tenantId, {
        deviceId,
        commandCode: def.code,
        category: def.category,
        params: validated,
        payloadText: payload.kind === 'text' ? payload.text : null,
        payloadHex: payload.kind === 'hex' ? payload.hex : null,
        issuedBy: ctx.actorType === 'USER' ? ctx.actorId : null,
        expiresAt,
      });
      const rec = DeviceCommandRepository.toRecord(row);
      await this.audit.append(trx, {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        action: 'device.command.issued',
        resourceType: 'device_command',
        resourceId: rec.id,
        permission: 'telemetry.command.send',
        outcome: 'SUCCESS',
        before: null,
        after: { deviceId, commandCode: def.code, params: validated },
      });
      return rec;
    });

    if (!this.producer) {
      // No Kafka wiring (tests / degraded boot) — mark failed immediately.
      await this.commands.markFailed(ctx.tenantId, record.id, 'KAFKA_UNAVAILABLE');
      throw new ServiceUnavailableException('Command transport unavailable.');
    }
    try {
      await this.producer.publish({
        commandId: record.id,
        deviceId,
        tenantId: ctx.tenantId,
        protocolId: 'meitrack',
        commandCode: def.code,
        payloadText: payload.kind === 'text' ? payload.text : null,
        payloadHex: payload.kind === 'hex' ? payload.hex : null,
      });
    } catch (err) {
      this.logger.error(`Command publish failed (${record.id}): ${(err as Error).message}`);
      await this.commands.markFailed(ctx.tenantId, record.id, 'PUBLISH_FAILED');
      throw new ServiceUnavailableException('Command queue unavailable — try again.');
    }
    return record;
  }

  /**
   * md300-main `live.js` sends AB2 as soon as the GPRS socket has an IMEI.
   * Mirror that on AUTHENTICATED: push `rtmp://PUBLIC_IP:1935/live/md300`.
   */
  public async startMdvrLiveOnConnect(tenantId: string, deviceId: string): Promise<void> {
    const now = Date.now();
    const prev = this.autoAb2At.get(deviceId) ?? 0;
    if (now - prev < 15_000) return;

    const host = this.options.mdvrPublicHost?.trim();
    if (!host) {
      this.logger.warn('Skipping auto-AB2: MDVR public host is unset.');
      return;
    }
    const path = mdvrChannelStreamPath(this.options.mdvrRtmpPath ?? 'live/md300', 1);
    const port = this.options.mdvrRtmpPort ?? 1935;
    const ctx: ActorContext = {
      tenantId,
      actorId: null,
      actorType: 'SYSTEM',
      requestId: null,
      ipAddress: null,
      userAgent: null,
    };
    try {
      await this.create(ctx, deviceId, {
        commandCode: 'AB2',
        params: {
          uploadUrl: `rtmp://${host}:${port}/${path}`,
          channel: 1,
          dataType: '0',
          streamType: '0',
        },
      });
      this.autoAb2At.set(deviceId, now);
      this.logger.log(`Auto AB2 sent for device ${deviceId} → rtmp://${host}:${port}/${path}`);
    } catch (err) {
      this.logger.warn(`Auto AB2 skipped for ${deviceId}: ${(err as Error).message}`);
    }
  }

  /**
   * A9A/A9D tell the device where to dial media. AB2/AB4 tell it where to
   * push RTMP. The SPA uses `window.location.hostname`, which is localhost
   * when the operator opens http://localhost:8080 — unusable from GPRS.
   * Rewrite loopback (and always pin AB2/AB4 to the configured public host).
   */
  private resolveMediaDialback(
    commandCode: string,
    params: Record<string, string | number | boolean>,
  ): Record<string, string | number | boolean> {
    const host = this.options.mdvrPublicHost?.trim() ?? '';
    if (!host) return params;

    if (commandCode === 'A9A' || commandCode === 'A9D') {
      const server = String(params.server ?? '');
      if (!isLoopbackHost(server)) return params;
      return {
        ...params,
        server: host,
        tcpPort: params.tcpPort ?? this.options.mdvrPublicPort ?? 6182,
      };
    }

    if (commandCode === 'AB2' || commandCode === 'AB4') {
      const key = commandCode === 'AB2' ? 'uploadUrl' : 'url';
      const raw = String(params[key] ?? '');
      if (!raw) return params;
      return {
        ...params,
        [key]: rewriteRtmpUrl(
          raw,
          host,
          this.options.mdvrRtmpPort ?? 1935,
          mdvrChannelStreamPath(
            this.options.mdvrRtmpPath ?? 'live/md300',
            params.channel,
            commandCode === 'AB4' ? 'playback' : 'live',
          ),
        ),
      };
    }

    return params;
  }

  /**
   * Apply one catalog command to many devices. Catalog/params are validated
   * once; each device is issued independently so a suspended unit does not
   * roll back the rest. Partial success is the contract (queued + failed).
   */
  public async createMany(
    ctx: ActorContext,
    input: BulkCreateDeviceCommandInput,
  ): Promise<BulkCommandResult> {
    const commandCode = input.commandCode.toUpperCase();
    const def = getCommandDef(commandCode);
    if (!def) {
      throw new BadRequestException(`Unknown command code '${input.commandCode}'.`);
    }
    try {
      validateParams(def, input.params ?? {});
    } catch (err) {
      if (err instanceof CommandValidationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const deviceIds = [...new Set(input.deviceIds)];
    const queued: DeviceCommandRecord[] = [];
    const failed: BulkCommandFailure[] = [];
    for (const deviceId of deviceIds) {
      try {
        queued.push(
          await this.create(ctx, deviceId, {
            commandCode,
            params: input.params,
            ttlSec: input.ttlSec,
          }),
        );
      } catch (err) {
        failed.push({
          deviceId,
          error: err instanceof Error ? err.message : 'Command failed.',
        });
      }
    }
    return { queued, failed };
  }

  public async list(
    ctx: ActorContext,
    filters: DeviceCommandListFilters,
    opts: { cursor?: string; limit: number },
  ): Promise<Page<DeviceCommandRecord>> {
    const page = await this.commands.list(ctx.tenantId, filters, opts);
    return {
      data: page.data.map(DeviceCommandRepository.toRecord),
      nextCursor: page.nextCursor,
    };
  }

  public async get(ctx: ActorContext, id: string): Promise<DeviceCommandRecord> {
    const row = await this.commands.findById(ctx.tenantId, id);
    if (!row) throw new NotFoundException('Command not found.');
    return DeviceCommandRepository.toRecord(row);
  }

  // --- TTL sweeper ------------------------------------------------------------

  /** Start the periodic EXPIRE sweep (module boot; no-op twice). */
  public startSweeper(): void {
    if (this.sweepTimer) return;
    const intervalMs = this.options.sweepIntervalSeconds * 1000;
    this.sweepTimer = setInterval(() => {
      this.commands
        .expireStale(new Date())
        .then((count) => {
          if (count > 0) this.logger.debug(`Expired ${count} unacked device command(s).`);
        })
        .catch((err) => this.logger.warn(`Command sweep failed: ${(err as Error).message}`));
    }, intervalMs);
    this.sweepTimer.unref?.();
  }

  public stopSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
