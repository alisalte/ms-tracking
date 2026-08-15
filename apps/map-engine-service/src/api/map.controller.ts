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
import type { ReplayService } from '../application/replay-service.js';
import { parseBbox } from '../domain/geo-types.js';
import { CLUSTER_SERVICE, REPLAY_SERVICE } from './tokens.js';

@Controller('map')
export class MapController {
  constructor(
    @Inject(CLUSTER_SERVICE) private readonly clusterService: ClusterService,
    @Inject(REPLAY_SERVICE) private readonly replayService: ReplayService,
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
    return this.replayService.getReplay(tenantId, vehicleId, fromTime, toTime);
  }

  @Get('heat')
  @RequirePermissions('maps.read')
  public async heat(@Query('bbox') _bbox: string, @Query('metric') _metric?: string) {
    // Sprint 9: heat-map aggregation from the position hypertable (H3 res-6).
    // Full implementation deferred — the cluster service is the building block.
    return { cells: [], metric: _metric ?? 'vehicle_count' };
  }

  @Get('layers')
  @RequirePermissions('maps.read')
  public async layers() {
    return {
      layers: ['traffic', 'satellite', 'weather', 'pois', 'geofences'],
    };
  }
}
