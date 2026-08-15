import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
/**
 * Map REST API — clusters, heat map, replay, layers (08 §5).
 *
 *   GET /map/clusters?bbox=&zoom=   — server-side H3 clusters.
 *   GET /map/heat?metric=&bbox=&zoom= — heat-map H3 cells.
 *   GET /map/replay?vehicleId=&from=&to= — GeoJSON FeatureCollection.
 *   GET /map/layers                  — available map layers.
 *
 * Sprint B: authentication + `maps.read` are enforced by the global guards. The
 * tenant is taken from the verified JWT (INV-I02).
 */
import { Controller, Get, HttpException, HttpStatus, Inject, Query } from '@nestjs/common';
import type { ClusterService } from '../application/cluster-service.js';
import type { HeatService } from '../application/heat-service.js';
import type { ReplayService } from '../application/replay-service.js';
import { parseBbox } from '../domain/geo-types.js';
import { CLUSTER_SERVICE, HEAT_SERVICE, REPLAY_SERVICE } from './tokens.js';

@Controller('map')
export class MapController {
  constructor(
    @Inject(CLUSTER_SERVICE) private readonly clusterService: ClusterService,
    @Inject(REPLAY_SERVICE) private readonly replayService: ReplayService,
    @Inject(HEAT_SERVICE) private readonly heatService: HeatService,
  ) {}

  @Get('clusters')
  @RequirePermissions('maps.read')
  public async clusters(
    @CurrentTenant() tenantId: string,
    @Query('bbox') bbox: string,
    @Query('zoom') zoom?: string,
  ) {
    const bb = parseBbox(bbox ?? '');
    if (!bb) throw new HttpException('Invalid bbox', HttpStatus.BAD_REQUEST);
    const z = zoom ? Number.parseInt(zoom, 10) : 10;
    return this.clusterService.getClusters(tenantId, bb.minLng, bb.minLat, bb.maxLng, bb.maxLat, z);
  }

  @Get('replay')
  @RequirePermissions('maps.read')
  public async replay(
    @CurrentTenant() tenantId: string,
    @Query('vehicleId') vehicleId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!vehicleId) throw new HttpException('vehicleId required', HttpStatus.BAD_REQUEST);
    const now = new Date();
    const fromTime = from ? new Date(from) : new Date(now.getTime() - 86_400_000);
    const toTime = to ? new Date(to) : now;
    if (Number.isNaN(fromTime.getTime()) || Number.isNaN(toTime.getTime())) {
      throw new HttpException('Invalid from/to timestamps', HttpStatus.BAD_REQUEST);
    }
    if (fromTime >= toTime) {
      throw new HttpException('from must be before to', HttpStatus.BAD_REQUEST);
    }
    const MAX_RANGE_MS = 31 * 86_400_000;
    if (toTime.getTime() - fromTime.getTime() > MAX_RANGE_MS) {
      throw new HttpException('Time range too large (max 31 days)', HttpStatus.BAD_REQUEST);
    }
    return this.replayService.getReplay(tenantId, vehicleId, fromTime, toTime);
  }

  @Get('heat')
  @RequirePermissions('maps.read')
  public async heat(
    @CurrentTenant() tenantId: string,
    @Query('bbox') bbox?: string,
    @Query('zoom') zoom?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('metric') metric?: string,
  ) {
    // Sprint F §19 — REAL position-density heat cells over the hypertable
    // (bounded window + capped scan; one metric: position_count).
    const m = metric ?? 'position_count';
    if (m !== 'position_count') {
      throw new HttpException(`Unsupported metric '${m}'`, HttpStatus.BAD_REQUEST);
    }
    const bb = parseBbox(bbox ?? '');
    if (!bb) throw new HttpException('Invalid bbox', HttpStatus.BAD_REQUEST);
    const now = new Date();
    const toTime = to ? new Date(to) : now;
    const fromTime = from ? new Date(from) : new Date(now.getTime() - 86_400_000);
    if (Number.isNaN(fromTime.getTime()) || Number.isNaN(toTime.getTime())) {
      throw new HttpException('Invalid from/to timestamps', HttpStatus.BAD_REQUEST);
    }
    if (fromTime >= toTime) {
      throw new HttpException('from must be before to', HttpStatus.BAD_REQUEST);
    }
    const MAX_RANGE_MS = 7 * 86_400_000;
    if (toTime.getTime() - fromTime.getTime() > MAX_RANGE_MS) {
      throw new HttpException('Time range too large (max 7 days)', HttpStatus.BAD_REQUEST);
    }
    const z = zoom ? Number.parseInt(zoom, 10) : 10;
    const cells = await this.heatService.getCells(
      tenantId,
      bb.minLng,
      bb.minLat,
      bb.maxLng,
      bb.maxLat,
      z,
      fromTime,
      toTime,
      m,
    );
    return { cells, metric: m, from: fromTime.toISOString(), to: toTime.toISOString() };
  }

  @Get('layers')
  @RequirePermissions('maps.read')
  public async layers() {
    // Real layer catalog (Sprint F): only layers the engine can actually serve
    // from its own APIs — the old list advertised traffic/satellite/weather
    // layers that do not exist anywhere.
    return {
      layers: ['base', 'vehicles', 'tracks', 'geofences', 'pois'],
    };
  }
}
