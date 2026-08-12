/**
 * Route REST API (08 §5).
 *
 *   GET  /route?waypoints=&mode=  — route between waypoints.
 *   POST /route/match             — map-match a position sequence.
 */
import { JwtAuthGuard, ZodValidationPipe, getPrincipal } from '@fleetvision/auth';
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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ProviderRouter } from '../application/provider-router.js';
import { type RouteMatchDto, routeMatchSchema } from './map-engine.dto.js';
import { PROVIDER_ROUTER } from './tokens.js';

@Controller('route')
@UseGuards(JwtAuthGuard)
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
    const tenantId = getPrincipal(req as Request).tenantId;
    const provider = this.router.select({ tenantId });
    return provider.route({
      waypoints: pts,
      mode: (mode ?? 'static') as 'static' | 'live' | 'optimized',
    });
  }

  @Post('match')
  public async match(
    @Body(new ZodValidationPipe(routeMatchSchema)) body: RouteMatchDto,
    @Req() req?: Request,
  ) {
    const tenantId = getPrincipal(req as Request).tenantId;
    const provider = this.router.select({ tenantId });
    return provider.matchRoute(body.points, tenantId);
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
