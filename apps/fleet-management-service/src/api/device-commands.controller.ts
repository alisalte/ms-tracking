/**
 * Device commands REST API — the device-configuration dispatch surface
 * (02 §6.1 `telemetry.command.*`; 06 §11.3 SendDeviceCommand).
 *
 *   GET    /api/v1/device-commands/catalog         ← the Meitrack MDVR command
 *                                                     catalog (UI form source)
 *   POST   /api/v1/device-commands/bulk            (same command, many devices)
 *   GET    /api/v1/device-commands/:id             (single record)
 *   POST   /api/v1/devices/:deviceId/commands      (issue — QUEUED, async ack)
 *   GET    /api/v1/devices/:deviceId/commands      (?cursor&limit&status&commandCode)
 *
 * Statuses: QUEUED → SENT (gateway wrote the frame) → ACKED/FAILED (device D82
 * reply) / EXPIRED (TTL). The UI polls the list for transitions.
 */
import { CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { DeviceCommandService } from '../application/device-command.service.js';
import {
  bulkCreateDeviceCommandSchema,
  createDeviceCommandSchema,
  deviceCommandListQuerySchema,
} from '../application/validation/schemas.js';
import { actorFrom, readActor } from './shared/actor.js';
import { ZodValidationPipe } from './shared/zod-validation.pipe.js';
import { DEVICE_COMMAND_SERVICE } from './tokens.js';

@Controller('api/v1/device-commands')
export class DeviceCommandsController {
  constructor(@Inject(DEVICE_COMMAND_SERVICE) private readonly commands: DeviceCommandService) {}

  /** The full command catalog (declared before :id so the static segment wins). */
  @Get('catalog')
  @RequirePermissions('telemetry.command.read')
  public async catalog() {
    return { data: this.commands.catalog() };
  }

  /**
   * Issue the same command to many devices. Partial success: some may queue
   * while others fail (inactive protocol, unknown id, …).
   */
  @Post('bulk')
  @HttpCode(200)
  @RequirePermissions('telemetry.command.send')
  public async createMany(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Body(new ZodValidationPipe(bulkCreateDeviceCommandSchema))
    body: {
      deviceIds: string[];
      commandCode: string;
      params?: Record<string, string | number | boolean>;
      ttlSec?: number;
    },
  ) {
    const result = await this.commands.createMany(actorFrom(auth, req), {
      ...body,
      commandCode: body.commandCode.toUpperCase(),
    });
    return { data: result };
  }

  @Get(':id')
  @RequirePermissions('telemetry.command.read')
  public async get(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const record = await this.commands.get(actorFrom(auth, req), id);
    return { data: record };
  }
}

@Controller('api/v1/devices/:deviceId/commands')
export class DeviceCommandIssuesController {
  constructor(@Inject(DEVICE_COMMAND_SERVICE) private readonly commands: DeviceCommandService) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('telemetry.command.send')
  public async create(
    @CurrentUser() auth: AuthenticatedContext,
    @Req() req: Request,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body(new ZodValidationPipe(createDeviceCommandSchema))
    body: {
      commandCode: string;
      params?: Record<string, string | number | boolean>;
      ttlSec?: number;
    },
  ) {
    const record = await this.commands.create(actorFrom(auth, req), deviceId, {
      commandCode: body.commandCode.toUpperCase(),
      params: body.params,
      ttlSec: body.ttlSec,
    });
    return { data: record };
  }

  @Get()
  @RequirePermissions('telemetry.command.read')
  public async list(
    @CurrentUser() auth: AuthenticatedContext,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('commandCode') commandCode?: string,
  ) {
    const query = deviceCommandListQuerySchema.parse({
      cursor,
      limit,
      status,
      commandCode,
    });
    const page = await this.commands.list(
      readActor(auth),
      {
        deviceId,
        status: query.status,
        commandCode: query.commandCode,
      },
      { cursor: query.cursor, limit: query.limit },
    );
    return page;
  }
}
