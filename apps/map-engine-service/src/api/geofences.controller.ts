/**
 * Geofence REST API — Sprint I §10/§11/§16/§17.
 *
 *   GET    /geofences                 — paginated list + filters
 *                                       (status, type, search, vehicleId, limit, cursor).
 *   GET    /geofences/:id             — detail.
 *   POST   /geofences                 — create (validated client- AND server-side;
 *                                       PostGIS ST_IsValid is authoritative).
 *   PUT    /geofences/:id             — update (incl. geometry re-draw).
 *   DELETE /geofences/:id             — archive (soft delete — historical alarm/
 *                                       event references stay resolvable).
 *   POST   /geofences/:id/status      — activate / deactivate (ACTIVE | INACTIVE).
 *   GET    /geofences/:id/vehicles    — assigned vehicles.
 *   PUT    /geofences/:id/vehicles    — replace assignment set (ids[]).
 *   POST   /geofences/:id/vehicles    — assign one vehicle { vehicleId }.
 *   DELETE /geofences/:id/vehicles/:vehicleId — unassign.
 *
 * Auth: global guards (JWT → PermissionsGuard). Reads require `maps.read`,
 * every mutation requires `maps.write` (existing Sprint F permission names —
 * no duplicate permission catalog entries). Tenant ALWAYS comes from the
 * verified principal (`@CurrentTenant`) — body/query tenantId is never read.
 *
 * The legacy `/location/geofences*` routes (LocationController) remain for
 * backward compatibility (Sprint I §71) and delegate to the same service.
 */
import { CurrentTenant, CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { GeofenceService } from '../application/geofence-service.js';
import { GeofenceValidationError } from '../domain/geofence-validation.js';
import { GEOFENCE_SERVICE } from './tokens.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('geofences')
export class GeofencesController {
  constructor(@Inject(GEOFENCE_SERVICE) private readonly geofenceService: GeofenceService) {}

  @Get()
  @RequirePermissions('maps.read')
  public async list(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    try {
      return await this.geofenceService.listPage(tenantId, {
        status: status?.trim() || undefined,
        type: type?.trim() || undefined,
        search: search?.trim() || undefined,
        vehicleId: vehicleId?.trim() || undefined,
        limit: limit ? Number(limit) : 25,
        cursor: cursor ?? null,
      });
    } catch (err) {
      throw toBadRequest(err);
    }
  }

  @Get(':id')
  @RequirePermissions('maps.read')
  public async getOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    requireUuid(id, 'geofence id');
    const fence = await this.geofenceService.findById(id, tenantId);
    if (!fence) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return fence;
  }

  @Post()
  @RequirePermissions('maps.write')
  public async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      return await this.geofenceService.create({
        tenantId,
        actorId: user?.userId ?? null,
        requestId: headerString(req, 'x-request-id'),
        name: String(body.name ?? ''),
        type: parseType(body.type),
        boundaryGeoJson: body.boundary as { type: 'Polygon'; coordinates: number[][][] },
        description: body.description !== undefined ? String(body.description ?? '') : undefined,
        centerLat: body.centerLat !== undefined ? Number(body.centerLat) : undefined,
        centerLng: body.centerLng !== undefined ? Number(body.centerLng) : undefined,
        radiusM: body.radiusM !== undefined ? Number(body.radiusM) : undefined,
        alertOn: Array.isArray(body.alertOn) ? (body.alertOn as string[]) : undefined,
        dwellSec: body.dwellSec !== undefined ? Number(body.dwellSec) : undefined,
      });
    } catch (err) {
      throw toBadRequest(err);
    }
  }

  @Put(':id')
  @RequirePermissions('maps.write')
  public async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    requireUuid(id, 'geofence id');
    try {
      const updated = await this.geofenceService.update(id, tenantId, {
        actorId: user?.userId ?? null,
        requestId: headerString(req, 'x-request-id'),
        name: body.name !== undefined ? String(body.name) : undefined,
        description:
          body.description === undefined
            ? undefined
            : body.description === null
              ? null
              : String(body.description),
        boundaryGeoJson: body.boundary as
          | { type: 'Polygon'; coordinates: number[][][] }
          | undefined,
        centerLat: body.centerLat !== undefined ? Number(body.centerLat) : undefined,
        centerLng: body.centerLng !== undefined ? Number(body.centerLng) : undefined,
        radiusM: body.radiusM !== undefined ? Number(body.radiusM) : undefined,
        alertOn: Array.isArray(body.alertOn) ? (body.alertOn as string[]) : undefined,
        dwellSec:
          body.dwellSec === undefined
            ? undefined
            : body.dwellSec === null
              ? null
              : Number(body.dwellSec),
      });
      if (!updated) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
      return updated;
    } catch (err) {
      throw toBadRequest(err);
    }
  }

  @Delete(':id')
  @RequirePermissions('maps.write')
  public async archive(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    requireUuid(id, 'geofence id');
    const ok = await this.geofenceService.archive(id, tenantId, {
      actorId: user?.userId ?? null,
      requestId: headerString(req, 'x-request-id'),
    });
    if (!ok) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return { archived: true };
  }

  @Post(':id/status')
  @RequirePermissions('maps.write')
  public async setStatus(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    requireUuid(id, 'geofence id');
    try {
      const status = body.status;
      if (status !== 'ACTIVE' && status !== 'INACTIVE' && status !== 'ARCHIVED') {
        throw new GeofenceValidationError(
          "status must be 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'",
          'INVALID_STATUS',
        );
      }
      const updated = await this.geofenceService.setStatus(id, tenantId, status, {
        actorId: user?.userId ?? null,
        requestId: headerString(req, 'x-request-id'),
      });
      if (!updated) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
      return updated;
    } catch (err) {
      throw toBadRequest(err);
    }
  }

  @Get(':id/vehicles')
  @RequirePermissions('maps.read')
  public async listVehicles(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    requireUuid(id, 'geofence id');
    const fence = await this.geofenceService.findById(id, tenantId);
    if (!fence) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return { vehicleIds: fence.assignedVehicleIds };
  }

  @Put(':id/vehicles')
  @RequirePermissions('maps.write')
  public async replaceVehicles(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    requireUuid(id, 'geofence id');
    const ids = Array.isArray(body.vehicleIds) ? (body.vehicleIds as unknown[]) : null;
    if (!ids) {
      throw new HttpException('vehicleIds array required', HttpStatus.BAD_REQUEST);
    }
    for (const v of ids) {
      if (typeof v !== 'string' || !UUID_RE.test(v)) {
        throw new HttpException(
          `vehicleId ${JSON.stringify(v)} is not a uuid`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    try {
      const updated = await this.geofenceService.replaceAssignments(tenantId, id, ids as string[], {
        actorId: user?.userId ?? null,
        requestId: headerString(req, 'x-request-id'),
      });
      if (!updated) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
      return updated;
    } catch (err) {
      throw toBadRequest(err);
    }
  }

  @Post(':id/vehicles')
  @RequirePermissions('maps.write')
  public async assignVehicle(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    requireUuid(id, 'geofence id');
    const vehicleId = String(body.vehicleId ?? '');
    if (!UUID_RE.test(vehicleId)) {
      throw new HttpException('vehicleId must be a uuid', HttpStatus.BAD_REQUEST);
    }
    try {
      const updated = await this.geofenceService.assign(tenantId, id, vehicleId, {
        actorId: user?.userId ?? null,
        requestId: headerString(req, 'x-request-id'),
      });
      if (!updated) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
      return updated;
    } catch (err) {
      throw toBadRequest(err);
    }
  }

  @Delete(':id/vehicles/:vehicleId')
  @RequirePermissions('maps.write')
  public async unassignVehicle(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    requireUuid(id, 'geofence id');
    if (!UUID_RE.test(vehicleId)) {
      throw new HttpException('vehicleId must be a uuid', HttpStatus.BAD_REQUEST);
    }
    const ok = await this.geofenceService.unassign(tenantId, id, vehicleId, {
      actorId: user?.userId ?? null,
      requestId: headerString(req, 'x-request-id'),
    });
    if (!ok) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return { unassigned: true };
  }
}

function parseType(raw: unknown): 'POLYGON' | 'CIRCLE' | 'CORRIDOR' {
  if (raw === 'POLYGON' || raw === 'CIRCLE' || raw === 'CORRIDOR') return raw;
  throw new GeofenceValidationError(
    "type must be 'POLYGON' | 'CIRCLE' ('CORRIDOR' accepted for legacy rows)",
    'INVALID_TYPE',
  );
}

function requireUuid(value: string, what: string): void {
  if (!UUID_RE.test(value)) {
    throw new HttpException(`Invalid ${what}`, HttpStatus.BAD_REQUEST);
  }
}

function headerString(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Controlled 4xx for validation failures — no stack traces to clients. */
function toBadRequest(err: unknown): HttpException {
  if (err instanceof GeofenceValidationError) {
    return new HttpException(
      { message: err.message, code: err.code, detail: err.detail ?? null },
      HttpStatus.BAD_REQUEST,
    );
  }
  return err instanceof HttpException
    ? err
    : new HttpException('Geofence operation failed', HttpStatus.BAD_REQUEST);
}
