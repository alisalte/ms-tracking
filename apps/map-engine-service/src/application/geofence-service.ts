/**
 * Geofence service — CRUD lifecycle + point-in-polygon check
 * (08 §4; Sprint I §10/§11/§16/§17/§58).
 *
 * The Map Engine owns the geometry store + CRUD; the GPS Engine owns live
 * evaluation. This service orchestrates: input validation (domain module +
 * PostGIS via the repo), the mutation, the audit entry (shared hash-chained
 * `audit.audit_entries` — never a second audit system), and the bounded
 * mutation metric.
 */
import type { TelemetryMetrics } from '@fleetvision/observability';
import type { Geofence } from '../domain/geo-types.js';
import { GeofenceValidationError } from '../domain/geofence-validation.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import type {
  GeofenceListFilters,
  GeofencePage,
  GeofenceRepository,
} from '../infrastructure/persistence/geofence.repository.js';

export interface GeofenceServiceDeps {
  readonly repo: GeofenceRepository;
  readonly audit?: AuditRepository | null;
  readonly metrics?: TelemetryMetrics | null;
  readonly logger?: { debug(message: string): void } | null;
}

export class GeofenceService {
  constructor(private readonly deps: GeofenceServiceDeps) {}

  public async create(input: {
    tenantId: string;
    actorId?: string | null;
    requestId?: string | null;
    name: string;
    type: 'POLYGON' | 'CIRCLE' | 'CORRIDOR';
    boundaryGeoJson: { type: 'Polygon'; coordinates: number[][][] };
    description?: string;
    centerLat?: number;
    centerLng?: number;
    radiusM?: number;
    alertOn?: string[];
    dwellSec?: number;
    createdBy?: string;
  }): Promise<Geofence> {
    if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
      throw new GeofenceValidationError('Geofence name is required', 'INVALID_NAME');
    }
    if (input.name.length > 200) {
      throw new GeofenceValidationError('Geofence name must be ≤ 200 characters', 'INVALID_NAME');
    }
    const created = await this.deps.repo.create(input);
    this.deps.metrics?.geofenceMutations.inc({ action: 'created' });
    void this.deps.audit?.appendBestEffort({
      tenantId: input.tenantId,
      actorId: input.actorId ?? input.createdBy ?? null,
      action: 'geofence.created',
      resourceType: 'geofence',
      resourceId: created.id,
      outcome: 'SUCCESS',
      requestId: input.requestId ?? null,
      before: null,
      after: { name: created.name, type: created.type, status: created.status },
    });
    return created;
  }

  public async findById(id: string, tenantId: string): Promise<Geofence | null> {
    return this.deps.repo.findById(id, tenantId);
  }

  public async list(tenantId: string): Promise<Geofence[]> {
    return this.deps.repo.list(tenantId);
  }

  public async listPage(tenantId: string, filters: GeofenceListFilters): Promise<GeofencePage> {
    return this.deps.repo.listPage(tenantId, filters);
  }

  /** Which geofences contain this point? (exact PostGIS, set-based). */
  public async containsPoint(
    tenantId: string,
    latitude: number,
    longitude: number,
  ): Promise<string[]> {
    return this.deps.repo.containsPoint(tenantId, latitude, longitude);
  }

  public async update(
    id: string,
    tenantId: string,
    patch: Parameters<GeofenceRepository['update']>[2] & {
      actorId?: string | null;
      requestId?: string | null;
    },
  ): Promise<Geofence | null> {
    const before = await this.deps.repo.findById(id, tenantId);
    if (!before) return null;
    const after = await this.deps.repo.update(id, tenantId, patch);
    if (!after) return null;
    this.deps.metrics?.geofenceMutations.inc({ action: 'updated' });
    void this.deps.audit?.appendBestEffort({
      tenantId,
      actorId: patch.actorId ?? null,
      action: 'geofence.updated',
      resourceType: 'geofence',
      resourceId: id,
      outcome: 'SUCCESS',
      requestId: patch.requestId ?? null,
      before: { name: before.name, type: before.type, radiusM: before.radiusM },
      after: { name: after.name, type: after.type, radiusM: after.radiusM },
    });
    return after;
  }

  public async setStatus(
    id: string,
    tenantId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
    ctx?: { actorId?: string | null; requestId?: string | null },
  ): Promise<Geofence | null> {
    const updated = await this.deps.repo.setStatus(id, tenantId, status);
    if (!updated) return null;
    const action =
      status === 'ACTIVE'
        ? 'geofence.activated'
        : status === 'INACTIVE'
          ? 'geofence.deactivated'
          : 'geofence.deleted';
    this.deps.metrics?.geofenceMutations.inc({
      action:
        status === 'ACTIVE' ? 'activated' : status === 'INACTIVE' ? 'deactivated' : 'archived',
    });
    void this.deps.audit?.appendBestEffort({
      tenantId,
      actorId: ctx?.actorId ?? null,
      action,
      resourceType: 'geofence',
      resourceId: id,
      outcome: 'SUCCESS',
      requestId: ctx?.requestId ?? null,
      before: null,
      after: { status },
    });
    return updated;
  }

  /** Soft delete = archive (Sprint I §10 — references stay resolvable). */
  public async archive(
    id: string,
    tenantId: string,
    ctx?: { actorId?: string | null; requestId?: string | null },
  ): Promise<boolean> {
    return (await this.setStatus(id, tenantId, 'ARCHIVED', ctx)) !== null;
  }

  /** Hard delete — legacy Sprint F/G behavior (legacy endpoint only). */
  public async delete(
    id: string,
    tenantId: string,
    ctx?: { actorId?: string | null; requestId?: string | null },
  ): Promise<boolean> {
    const ok = await this.deps.repo.delete(id, tenantId);
    if (ok) {
      this.deps.metrics?.geofenceMutations.inc({ action: 'deleted' });
      void this.deps.audit?.appendBestEffort({
        tenantId,
        actorId: ctx?.actorId ?? null,
        action: 'geofence.deleted',
        resourceType: 'geofence',
        resourceId: id,
        outcome: 'SUCCESS',
        requestId: ctx?.requestId ?? null,
        before: null,
        after: null,
      });
    }
    return ok;
  }

  // --- Assignments (Sprint I §16) ---

  public async assign(
    tenantId: string,
    geofenceId: string,
    vehicleId: string,
    ctx?: { actorId?: string | null; requestId?: string | null },
  ): Promise<Geofence | null> {
    const fence = await this.deps.repo.findById(geofenceId, tenantId);
    if (!fence) return null;
    await this.deps.repo.assign(tenantId, geofenceId, vehicleId, ctx?.actorId ?? undefined);
    this.deps.metrics?.geofenceMutations.inc({ action: 'assigned' });
    void this.deps.audit?.appendBestEffort({
      tenantId,
      actorId: ctx?.actorId ?? null,
      action: 'geofence.assigned',
      resourceType: 'geofence',
      resourceId: geofenceId,
      outcome: 'SUCCESS',
      requestId: ctx?.requestId ?? null,
      before: null,
      after: { vehicleId },
    });
    return this.deps.repo.findById(geofenceId, tenantId);
  }

  public async unassign(
    tenantId: string,
    geofenceId: string,
    vehicleId: string,
    ctx?: { actorId?: string | null; requestId?: string | null },
  ): Promise<boolean> {
    const ok = await this.deps.repo.unassign(tenantId, geofenceId, vehicleId);
    if (ok) {
      this.deps.metrics?.geofenceMutations.inc({ action: 'unassigned' });
      void this.deps.audit?.appendBestEffort({
        tenantId,
        actorId: ctx?.actorId ?? null,
        action: 'geofence.unassigned',
        resourceType: 'geofence',
        resourceId: geofenceId,
        outcome: 'SUCCESS',
        requestId: ctx?.requestId ?? null,
        before: { vehicleId },
        after: null,
      });
    }
    return ok;
  }

  public async replaceAssignments(
    tenantId: string,
    geofenceId: string,
    vehicleIds: readonly string[],
    ctx?: { actorId?: string | null; requestId?: string | null },
  ): Promise<Geofence | null> {
    const fence = await this.deps.repo.findById(geofenceId, tenantId);
    if (!fence) return null;
    await this.deps.repo.replaceAssignments(
      tenantId,
      geofenceId,
      vehicleIds,
      ctx?.actorId ?? undefined,
    );
    if (vehicleIds.length > 0) {
      this.deps.metrics?.geofenceMutations.inc({ action: 'assigned' });
    }
    void this.deps.audit?.appendBestEffort({
      tenantId,
      actorId: ctx?.actorId ?? null,
      action: 'geofence.assigned',
      resourceType: 'geofence',
      resourceId: geofenceId,
      outcome: 'SUCCESS',
      requestId: ctx?.requestId ?? null,
      before: { vehicleIds: fence.assignedVehicleIds },
      after: { vehicleIds },
    });
    return this.deps.repo.findById(geofenceId, tenantId);
  }
}
