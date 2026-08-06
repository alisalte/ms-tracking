/**
 * Geofence service — CRUD + point-in-polygon check (08 §4).
 *
 * The Map Engine owns the geometry store + CRUD. The `containsPoint()` query is
 * the bridge the GPS Engine's geofence FSM would call (PostGIS ST_Covers).
 */
import type { Geofence } from '../domain/geo-types.js';
import type { GeofenceRepository } from '../infrastructure/persistence/geofence.repository.js';

export interface GeofenceServiceDeps {
  readonly repo: GeofenceRepository;
}

export class GeofenceService {
  constructor(private readonly deps: GeofenceServiceDeps) {}

  public async create(input: {
    tenantId: string;
    name: string;
    type: 'POLYGON' | 'CIRCLE' | 'CORRIDOR';
    boundaryGeoJson: { type: 'Polygon'; coordinates: number[][][] };
    centerLat?: number;
    centerLng?: number;
    radiusM?: number;
    alertOn?: string[];
    dwellSec?: number;
  }): Promise<Geofence> {
    return this.deps.repo.create(input);
  }

  public async list(tenantId: string): Promise<Geofence[]> {
    return this.deps.repo.list(tenantId);
  }

  /** Which geofences contain this point? (PostGIS ST_Covers). */
  public async containsPoint(
    tenantId: string,
    latitude: number,
    longitude: number,
  ): Promise<string[]> {
    return this.deps.repo.containsPoint(tenantId, latitude, longitude);
  }

  public async delete(id: string, tenantId: string): Promise<boolean> {
    return this.deps.repo.delete(id, tenantId);
  }
}
