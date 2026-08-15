import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
/**
 * Route REST API (08 §5).
 *
 *   GET  /route?waypoints=&mode=  — route between waypoints.
 *   POST /route/match             — map-match a position sequence.
 *
 * Sprint B: authentication + `maps.read` enforced globally; tenant from JWT.
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Query,
} from '@nestjs/common';
import type { ProviderRouter } from '../application/provider-router.js';
import { PROVIDER_ROUTER } from './tokens.js';

@Controller('route')
export class RouteController {
  constructor(@Inject(PROVIDER_ROUTER) private readonly router: ProviderRouter) {}

  @Get()
  @RequirePermissions('maps.read')
  public async route(
    @CurrentTenant() tenantId: string,
    @Query('waypoints') waypoints?: string,
    @Query('mode') mode?: string,
  ) {
    if (!waypoints) throw new HttpException('waypoints required', HttpStatus.BAD_REQUEST);
    const pts = parseWaypoints(waypoints);
    if (pts.length < 2)
      throw new HttpException('At least 2 waypoints required', HttpStatus.BAD_REQUEST);
    const provider = this.router.select({ tenantId });
    return provider.route({
      waypoints: pts,
      mode: (mode ?? 'static') as 'static' | 'live' | 'optimized',
    });
  }

  @Post('match')
  @RequirePermissions('maps.read')
  public async match(@CurrentTenant() tenantId: string, @Body() body: Record<string, unknown>) {
    const points = (body.points as { lat: number; lng: number }[]) ?? [];
    if (points.length === 0) throw new HttpException('points required', HttpStatus.BAD_REQUEST);
    const provider = this.router.select({ tenantId });
    return provider.matchRoute(points, tenantId);
  }
}

/** Parse "lat1,lng1;lat2,lng2;..." into points. */
function parseWaypoints(wp: string): { lat: number; lng: number }[] {
  return wp
    .split(';')
    .map((pair) => {
      const [lat, lng] = pair.split(',').map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    })
    .filter((p): p is { lat: number; lng: number } => p !== null);
}
