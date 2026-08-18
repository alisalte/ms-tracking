/**
 * Summary REST API (Sprint E §21) — the dashboard's count aggregate.
 *
 *   GET /api/v1/summary  — { fleets, vehicles, devices } counts for the tenant.
 *
 * Requires all three domain read permissions: the response aggregates every
 * fleet-management domain, so a caller must be entitled to all of them (a
 * fleet-only viewer must not learn device counts). The tenant comes from the
 * verified credential (INV-I02).
 */
import { CurrentUser, RequirePermissions } from '@fleetvision/auth';
import type { AuthenticatedContext } from '@fleetvision/auth';
import { Controller, Get, Inject } from '@nestjs/common';
import type { SummaryService } from '../application/summary.service.js';
import { readActor } from './shared/actor.js';
import { SUMMARY_SERVICE } from './tokens.js';

@Controller('api/v1/summary')
export class SummaryController {
  constructor(@Inject(SUMMARY_SERVICE) private readonly summary: SummaryService) {}

  @Get()
  @RequirePermissions('fleet.read', 'vehicle.read', 'device.read')
  public async get(@CurrentUser() auth: AuthenticatedContext) {
    return { data: await this.summary.get(readActor(auth).tenantId) };
  }
}
