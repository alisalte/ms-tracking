/**
 * Route REST API (08 §5).
 *
 *   GET  /route?waypoints=&mode=  — route between waypoints.
 *   POST /route/match             — map-match a position sequence.
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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ProviderRouter } from '../application/provider-router.js';
import { PROVIDER_ROUTER } from './tokens.js';

@Controller('route')
export class RouteController {
  constructor(@Inject(PROVIDER_ROUTER) private readonly router: ProviderRouter) {}

  @Get()
  public async route(
    @Query('waypoints') waypoints?: string,
    @Query('mode') mode?: string,
    @Req() req?: Request,
  ) {
    if (!waypoints) throw new HttpException('waypoints required', HttpStatus.BAD_REQUEST);
    const pts = parseWaypoints(waypoints);
    if (pts.length < 2)
      throw new HttpException('At least 2 waypoints required', HttpStatus.BAD_REQUEST);
    const provider = this.router.select({ tenantId: tenantOf(req) });
    return provider.route({
      waypoints: pts,
      mode: (mode ?? 'static') as 'static' | 'live' | 'optimized',
    });
  }

  @Post('match')
  public async match(@Body() body: Record<string, unknown>, @Req() req?: Request) {
    const points = (body.points as { lat: number; lng: number }[]) ?? [];
    if (points.length === 0) throw new HttpException('points required', HttpStatus.BAD_REQUEST);
    const provider = this.router.select({ tenantId: tenantOf(req) });
    return provider.matchRoute(points, tenantOf(req));
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

function tenantOf(req?: Request): string {
  const tid =
    (req?.headers['tenant-id'] as string | undefined) ??
    (req?.query['tenant-id'] as string | undefined);
  if (!tid)
    throw new HttpException('tenant-id header or query is required.', HttpStatus.BAD_REQUEST);
  return tid;
}
