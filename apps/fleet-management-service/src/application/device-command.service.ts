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
import type { CreateDeviceCommandInput } from './validation/schemas.js';

export interface DeviceCommandServiceOptions {
  /** Default TTL (seconds) applied when the request doesn't override it. */
  readonly defaultTtlSeconds: number;
  /** TTL sweeper interval (seconds). */
  readonly sweepIntervalSeconds: number;
}

export class DeviceCommandService {
  private readonly logger = new Logger(DeviceCommandService.name);
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly knex: Knex,
    private readonly devices: DeviceRepository,
    private readonly commands: DeviceCommandRepository,
    private readonly audit: AuditRepository,
    private readonly producer: CommandRequestProducer | null,
    private readonly options: DeviceCommandServiceOptions,
  ) {}

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
      validated = validateParams(def, input.params ?? {});
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
