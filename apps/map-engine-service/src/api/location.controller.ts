import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
/**
 * Location + Geofence REST API (08 §5).
 *
 *   GET  /location/geocode?q=         — forward geocode.
 *   GET  /location/reverse?lat=&lng=  — reverse geocode.
 *   GET  /location/pois?bbox=&category= — POI catalog.
 *   POST /location/pois               — create POI.
 *   GET  /location/nearest?lat=&lng=&radius=&k= — nearest-K POIs.
 *   GET  /location/geofences          — list geofences.
 *   POST /location/geofences          — create geofence.
 *   DELETE /location/geofences/:id    — delete geofence.
 *   GET  /location/geofences/contains?lat=&lng= — point-in-geofence check.
 *
 * Sprint B: authentication enforced globally; reads require `maps.read`, POI/
 * geofence create+delete require `maps.write`. Tenant from the verified JWT.
 */
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
  Query,
} from '@nestjs/common';
import type { GeofenceService } from '../application/geofence-service.js';
import type { PoiService } from '../application/poi-service.js';
import type { ProviderRouter } from '../application/provider-router.js';
import { parseBbox } from '../domain/geo-types.js';
import { GeofenceValidationError } from '../domain/geofence-validation.js';
import { MapProviderUnavailableError, RouteUnavailableError } from '../domain/provider-errors.js';
import { GEOFENCE_SERVICE, POI_SERVICE, PROVIDER_ROUTER } from './tokens.js';

@Controller()
export class LocationController {
  constructor(
    @Inject(PROVIDER_ROUTER) private readonly router: ProviderRouter,
    @Inject(POI_SERVICE) private readonly poiService: PoiService,
    @Inject(GEOFENCE_SERVICE) private readonly geofenceService: GeofenceService,
  ) {}

  // --- Geocoding (provider-routed) ---

  @Get('location/geocode')
  @RequirePermissions('maps.read')
  public async geocode(@CurrentTenant() tenantId: string, @Query('q') q: string) {
    if (!q) throw new HttpException('Query q required', HttpStatus.BAD_REQUEST);
    try {
      const provider = this.router.selectFor('geocode', { tenantId });
      return await provider.geocode({ query: q, tenantId });
    } catch (err) {
      throw toServiceUnavailable(err);
    }
  }

  @Get('location/reverse')
  @RequirePermissions('maps.read')
  public async reverse(
    @CurrentTenant() tenantId: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    const latitude = lat ? Number(lat) : Number.NaN;
    const longitude = lng ? Number(lng) : Number.NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new HttpException('Valid lat + lng required', HttpStatus.BAD_REQUEST);
    }
    try {
      const provider = this.router.selectFor('reverseGeocode', { tenantId });
      return await provider.reverseGeocode(latitude, longitude, tenantId);
    } catch (err) {
      throw toServiceUnavailable(err);
    }
  }

  // --- POIs ---

  @Get('location/pois')
  @RequirePermissions('maps.read')
  public async listPois(
    @CurrentTenant() tenantId: string,
    @Query('bbox') bbox?: string,
    @Query('category') category?: string,
  ) {
    if (!bbox) return [];
    const bb = parseBbox(bbox);
    if (!bb) throw new HttpException('Invalid bbox', HttpStatus.BAD_REQUEST);
    return this.poiService.findInBbox(tenantId, bb, category);
  }

  @Post('location/pois')
  @RequirePermissions('maps.write')
  public async createPoi(@CurrentTenant() tenantId: string, @Body() body: Record<string, unknown>) {
    return this.poiService.create({
      tenantId,
      name: String(body.name ?? ''),
      category: String(body.category ?? 'UNKNOWN'),
      latitude: Number(body.latitude ?? 0),
      longitude: Number(body.longitude ?? 0),
      radiusM: body.radiusM ? Number(body.radiusM) : 50,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
  }

  @Get('location/nearest')
  @RequirePermissions('maps.read')
  public async nearest(
    @CurrentTenant() tenantId: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radius') radius?: string,
    @Query('k') k?: string,
  ) {
    const latitude = lat ? Number(lat) : Number.NaN;
    const longitude = lng ? Number(lng) : Number.NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new HttpException('Valid lat + lng required', HttpStatus.BAD_REQUEST);
    }
    return this.poiService.resolvePoi(
      latitude,
      longitude,
      radius ? Number(radius) : 500,
      tenantId,
      k ? Number(k) : 5,
    );
  }

  // --- Geofences ---

  @Get('location/geofences')
  @RequirePermissions('maps.read')
  public async listGeofences(@CurrentTenant() tenantId: string) {
    return this.geofenceService.list(tenantId);
  }

  @Post('location/geofences')
  @RequirePermissions('maps.write')
  public async createGeofence(
    @CurrentTenant() tenantId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      return await this.geofenceService.create({
        tenantId,
        name: String(body.name ?? ''),
        type: (body.type as 'POLYGON' | 'CIRCLE' | 'CORRIDOR') ?? 'POLYGON',
        boundaryGeoJson: body.boundary as { type: 'Polygon'; coordinates: number[][][] },
        description: body.description !== undefined ? String(body.description ?? '') : undefined,
        centerLat: body.centerLat ? Number(body.centerLat) : undefined,
        centerLng: body.centerLng ? Number(body.centerLng) : undefined,
        radiusM: body.radiusM ? Number(body.radiusM) : undefined,
        alertOn: body.alertOn ? (body.alertOn as string[]) : undefined,
        dwellSec: body.dwellSec ? Number(body.dwellSec) : undefined,
      });
    } catch (err) {
      // Sprint I: the service now validates (PostGIS-authoritative); map the
      // controlled domain error to 400 instead of leaking a 500.
      if (err instanceof GeofenceValidationError) {
        throw new HttpException({ message: err.message, code: err.code }, HttpStatus.BAD_REQUEST);
      }
      throw err;
    }
  }

  @Delete('location/geofences/:id')
  @RequirePermissions('maps.write')
  public async deleteGeofence(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const ok = await this.geofenceService.delete(id, tenantId);
    if (!ok) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return { deleted: true };
  }

  @Get('location/geofences/contains')
  @RequirePermissions('maps.read')
  public async containsPoint(
    @CurrentTenant() tenantId: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    const latitude = lat ? Number(lat) : Number.NaN;
    const longitude = lng ? Number(lng) : Number.NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new HttpException('Valid lat + lng required', HttpStatus.BAD_REQUEST);
    }
    const geofenceIds = await this.geofenceService.containsPoint(tenantId, latitude, longitude);
    return { geofenceIds };
  }
}

/** Map controlled provider failures to HTTP 503 (never fabricated data). */
function toServiceUnavailable(err: unknown): HttpException {
  if (err instanceof MapProviderUnavailableError || err instanceof RouteUnavailableError) {
    return new HttpException(
      { message: err.message, code: err.code },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return err instanceof HttpException
    ? err
    : new HttpException('Geocoding failed', HttpStatus.BAD_GATEWAY);
}
