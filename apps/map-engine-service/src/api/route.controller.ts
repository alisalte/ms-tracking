import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
import { METRICS_TOKEN, type TelemetryMetrics } from '@fleetvision/observability';
/**
 * Route REST API (08 §5; Sprint F §12; Sprint I §38–§42).
 *
 *   GET  /route?waypoints=&mode=  — route between waypoints (provider-backed).
 *   POST /route/match             — map-match a position sequence (OSRM via the
 *                                   ProviderRouter; cached in Redis with a
 *                                   bounded TTL; 2..500 points).
 *
 * Sprint B: authentication + `maps.read` enforced globally; tenant from JWT.
 * Sprint F: routing is REAL (OSRM via the provider router) — when no routing
 * provider is configured/reachable the endpoint returns a controlled 503 with
 * the reason instead of fabricated straight-line geometry.
 * Sprint I: map matching takes the tracepoint-aligned result; the caller gets
 * per-point snapped coordinates (confidence 1) or the RAW point (confidence 0)
 * — never a fabricated road position.
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

const MAX_MATCH_POINTS = 500;

@Controller('route')
export class RouteController {
  constructor(
    @Inject(PROVIDER_ROUTER) private readonly router: ProviderRouter,
    @Inject(METRICS_TOKEN) private readonly metrics: TelemetryMetrics,
  ) {}

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
    const raw = (body.points as { lat?: unknown; lng?: unknown }[]) ?? [];
    if (!Array.isArray(raw) || raw.length < 2) {
      throw new HttpException(
        'points array with at least 2 entries required',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (raw.length > MAX_MATCH_POINTS) {
      throw new HttpException(
        `points exceeds the ${MAX_MATCH_POINTS}-point map-matching cap`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const points: { lat: number; lng: number }[] = [];
    for (const p of raw) {
      const lat = Number(p?.lat);
      const lng = Number(p?.lng);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        throw new HttpException(
          'each point needs finite lat [-90,90] / lng [-180,180]',
          HttpStatus.BAD_REQUEST,
        );
      }
      points.push({ lat, lng });
    }
    try {
      const provider = this.router.selectFor('matchRoute', { tenantId });
      const matched = await provider.matchRoute(points, tenantId);
      this.metrics.mapMatchRequests.inc({ result: 'success' });
      return matched;
    } catch (err) {
      // Provider absent/unreachable/invalid response → controlled 503. The
      // CLIENT falls back to the raw GPS track (Sprint I §39) — the backend
      // never returns fabricated matched geometry.
      this.metrics.mapMatchRequests.inc({ result: 'failure' });
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
