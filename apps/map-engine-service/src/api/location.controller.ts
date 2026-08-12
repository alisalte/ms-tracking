import {
  JwtAuthGuard,
  type PageRequestDto,
  ZodValidationPipe,
  getPrincipal,
  pageRequestSchema,
} from '@fleetvision/auth';
import { decodeCursor } from '@fleetvision/shared-kernel';
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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { GeofenceService } from '../application/geofence-service.js';
import type { PoiService } from '../application/poi-service.js';
import type { ProviderRouter } from '../application/provider-router.js';
import { parseBbox } from '../domain/geo-types.js';
import {
  type CreateGeofenceDto,
  type CreatePoiDto,
  createGeofenceSchema,
  createPoiSchema,
} from './map-engine.dto.js';
import { GEOFENCE_SERVICE, POI_SERVICE, PROVIDER_ROUTER } from './tokens.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class LocationController {
  constructor(
    @Inject(PROVIDER_ROUTER) private readonly router: ProviderRouter,
    @Inject(POI_SERVICE) private readonly poiService: PoiService,
    @Inject(GEOFENCE_SERVICE) private readonly geofenceService: GeofenceService,
  ) {}

  // --- Geocoding (provider-routed) ---

  @Get('location/geocode')
  public async geocode(@Query('q') q: string, @Req() req: Request) {
    if (!q) throw new HttpException('Query q required', HttpStatus.BAD_REQUEST);
    const provider = this.router.select({ tenantId: tenantOf(req) });
    return provider.geocode({ query: q, tenantId: tenantOf(req) });
  }

  @Get('location/reverse')
  public async reverse(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Req() req?: Request,
  ) {
    const latitude = lat ? Number(lat) : Number.NaN;
    const longitude = lng ? Number(lng) : Number.NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new HttpException('Valid lat + lng required', HttpStatus.BAD_REQUEST);
    }
    const provider = this.router.select({ tenantId: tenantOf(req) });
    return provider.reverseGeocode(latitude, longitude, tenantOf(req));
  }

  // --- POIs ---

  @Get('location/pois')
  public async listPois(
    @Query('bbox') bbox?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ) {
    if (!bbox) return [];
    const bb = parseBbox(bbox);
    if (!bb) throw new HttpException('Invalid bbox', HttpStatus.BAD_REQUEST);
    // limit is clamped to [1, MAX_PAGE_SIZE] in the repository; bbox queries are
    // spatial and never return an unbounded result set (Phase 6).
    return this.poiService.findInBbox(
      tenantOf(req),
      bb,
      category,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('location/pois')
  public async createPoi(
    @Body(new ZodValidationPipe(createPoiSchema)) body: CreatePoiDto,
    @Req() req: Request,
  ) {
    return this.poiService.create({
      tenantId: tenantOf(req as Request),
      name: body.name,
      category: body.category,
      latitude: body.latitude,
      longitude: body.longitude,
      radiusM: body.radiusM ?? 50,
      metadata: body.metadata ?? {},
    });
  }

  @Get('location/nearest')
  public async nearest(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radius') radius?: string,
    @Query('k') k?: string,
    @Req() req?: Request,
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
      tenantOf(req),
      k ? Number(k) : 5,
    );
  }

  // --- Geofences ---

  @Get('location/geofences')
  public async listGeofences(
    @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto,
    @Req() req: Request,
  ) {
    const tenantId = tenantOf(req as Request);
    const cursor = page.cursor
      ? (() => {
          const c = decodeCursor(page.cursor);
          return { createdAt: c.value, id: c.id ?? '' };
        })()
      : undefined;
    return this.geofenceService.listPage(tenantId, page.limit, cursor);
  }

  @Post('location/geofences')
  public async createGeofence(
    @Body(new ZodValidationPipe(createGeofenceSchema)) body: CreateGeofenceDto,
    @Req() req: Request,
  ) {
    return this.geofenceService.create({
      tenantId: tenantOf(req as Request),
      name: body.name,
      type: body.type,
      boundaryGeoJson: body.boundary,
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      radiusM: body.radiusM,
      alertOn: body.alertOn,
      dwellSec: body.dwellSec,
    });
  }

  @Delete('location/geofences/:id')
  public async deleteGeofence(@Param('id') id: string, @Req() req: Request) {
    const ok = await this.geofenceService.delete(id, tenantOf(req));
    if (!ok) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return { deleted: true };
  }

  @Get('location/geofences/contains')
  public async containsPoint(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Req() req?: Request,
  ) {
    const latitude = lat ? Number(lat) : Number.NaN;
    const longitude = lng ? Number(lng) : Number.NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new HttpException('Valid lat + lng required', HttpStatus.BAD_REQUEST);
    }
    const geofenceIds = await this.geofenceService.containsPoint(
      tenantOf(req),
      latitude,
      longitude,
    );
    return { geofenceIds };
  }
}

/** Derive the tenant id from the verified JWT principal (INV-I02). */
function tenantOf(req?: Request): string {
  return getPrincipal(req as Request).tenantId;
}
