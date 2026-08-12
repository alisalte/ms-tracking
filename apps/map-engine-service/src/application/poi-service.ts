/**
 * POI service — CRUD + nearest-K (08 §8.1; MapEngine.md §5.1).
 *
 * ResolvePOI is the GPS Engine Stop Engine's bridge: given a stop's location,
 * find the nearest POI within a radius to classify the stop purpose.
 */
import type { Poi } from '../domain/geo-types.js';
import type { PoiRepository } from '../infrastructure/persistence/poi.repository.js';

export interface PoiServiceDeps {
  readonly repo: PoiRepository;
}

export class PoiService {
  constructor(private readonly deps: PoiServiceDeps) {}

  public async create(input: {
    tenantId: string | null;
    name: string;
    category: string;
    latitude: number;
    longitude: number;
    radiusM?: number;
    metadata?: Record<string, unknown>;
  }): Promise<Poi> {
    return this.deps.repo.create(input);
  }

  /** Find POIs within a bounding box, optionally filtered by category. */
  public async findInBbox(
    tenantId: string | null,
    bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number },
    category?: string,
    limit?: number,
  ): Promise<Poi[]> {
    return this.deps.repo.findInBbox(
      tenantId,
      bbox.minLng,
      bbox.minLat,
      bbox.maxLng,
      bbox.maxLat,
      category,
      limit,
    );
  }

  /** ResolvePOI — nearest POI(s) to a point within a radius (08 §8.3). */
  public async resolvePoi(
    latitude: number,
    longitude: number,
    radiusM: number,
    tenantId?: string,
    k = 1,
  ): Promise<Array<Poi & { distanceM: number }>> {
    return this.deps.repo.findNearest(latitude, longitude, radiusM, k, tenantId);
  }
}
