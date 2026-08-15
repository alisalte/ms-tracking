import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
/**
 * Route REST API (08 §5; Sprint F §12).
 *
 *   GET  /route?waypoints=&mode=  — route between waypoints (provider-backed).
 *   POST /route/match             — map-match a position sequence.
 *
 * Sprint B: authentication + `maps.read` enforced globally; tenant from JWT.
 * Sprint F: routing is REAL (OSRM via the provider router) — when no routing
 * provider is configured/reachable the endpoint returns a controlled 503 with
 * the reason instead of fabricated straight-line geometry.
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
import { MapProviderUnavailableError, RouteUnavailableError } from '../domain/provider-errors.js';
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
    try {
      const provider = this.router.selectFor('route', { tenantId });
      return await provider.route({
        waypoints: pts,
        mode: (mode ?? 'static') as 'static' | 'live' | 'optimized',
        tenantId,
      });
    } catch (err) {
      throw toServiceUnavailable(err);
    }
  }

  @Post('match')
  @RequirePermissions('maps.read')
  public async match(@CurrentTenant() tenantId: string, @Body() body: Record<string, unknown>) {
    const points = (body.points as { lat: number; lng: number }[]) ?? [];
    if (points.length === 0) throw new HttpException('points required', HttpStatus.BAD_REQUEST);
    try {
      const provider = this.router.selectFor('matchRoute', { tenantId });
      return await provider.matchRoute(points, tenantId);
    } catch (err) {
      throw toServiceUnavailable(err);
    }
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
    : new HttpException('Routing failed', HttpStatus.BAD_GATEWAY);
}
