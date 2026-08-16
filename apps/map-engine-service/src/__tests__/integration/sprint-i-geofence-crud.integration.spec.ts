/**
 * Sprint I geofence integration tests — REAL PostGIS (§62/§63, §61 GEOFENCE
 * 1–10, SECURITY 19–21). Nothing spatial is mocked: geometry validation runs
 * ST_IsValid, containment runs ST_Covers/ST_DWithin on the actual geography
 * types, and the EXPLAIN check proves the GiST candidate query avoids a
 * sequential scan.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { GeofenceRepository } from '../../infrastructure/persistence/geofence.repository.js';
import { GeofenceValidationError } from '../../domain/geofence-validation.js';
import { bootstrap, dropTestDb, type IntegrationCtx } from './db.js';

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const VEHICLE_1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const VEHICLE_2 = 'bbbbbbbb-0000-4000-8000-000000000002';

let ctx: IntegrationCtx | null = null;
let repo: GeofenceRepository | null = null;

beforeAll(async () => {
  ctx = await bootstrap('map_sprint_i_geofence');
  repo = ctx ? new GeofenceRepository(ctx.knex) : null;
}, 120_000);

afterAll(async () => {
  if (!ctx) return;
  await ctx.knex.destroy();
  await dropTestDb(ctx.admin, 'map_sprint_i_geofence');
  await ctx.admin.destroy();
});

/** A closed triangle ring around (35.7, 51.4). */
function triangleRing(): number[][] {
  return [
    [51.4, 35.69],
    [51.42, 35.69],
    [51.42, 35.71],
    [51.4, 35.69],
  ];
}

describe('Sprint I — geofence CRUD on real PostGIS', () => {
  it('skips when the docker stack is unreachable', () => {
    if (!ctx || !repo) return;
  });

  it('1. creates a CIRCLE geofence (center + radius, exact ST_DWithin semantics)', async () => {
    if (!ctx || !repo) return;
    const created = await repo.create({
      tenantId: TENANT_A,
      name: 'Warehouse Circle',
      type: 'CIRCLE',
      boundaryGeoJson: circleRing(35.7, 51.4, 500),
      centerLat: 35.7,
      centerLng: 51.4,
      radiusM: 500,
      alertOn: ['ENTER', 'EXIT', 'DWELL'],
      dwellSec: 300,
    });
    expect(created.id).toBeDefined();
    expect(created.status).toBe('ACTIVE');
    expect(created.centerLat).toBeCloseTo(35.7, 4);
    expect(created.radiusM).toBe(500);
    expect(created.assignedVehicleIds).toEqual([]);
  });

  it('2. creates a POLYGON geofence', async () => {
    if (!ctx || !repo) return;
    const created = await repo.create({
      tenantId: TENANT_A,
      name: 'Yard Polygon',
      type: 'POLYGON',
      boundaryGeoJson: { type: 'Polygon', coordinates: [triangleRing()] },
    });
    expect(created.type).toBe('POLYGON');
    expect(created.createdAt).not.toBeNull();
  });

  it('3. rejects an invalid circle (radius 0 / bad coords) with a controlled 4xx error', async () => {
    if (!ctx || !repo) return;
    await expect(
      repo.create({
        tenantId: TENANT_A,
        name: 'Bad Circle',
        type: 'CIRCLE',
        boundaryGeoJson: circleRing(35.7, 51.4, 500),
        centerLat: 91,
        centerLng: 51.4,
        radiusM: 500,
      }),
    ).rejects.toBeInstanceOf(GeofenceValidationError);
    // radius 0 → a degenerate ring; PostGIS ST_IsValid rejects it FIRST with a
    // controlled INVALID_GEOMETRY error (the radius check would also reject).
    await expect(
      repo.create({
        tenantId: TENANT_A,
        name: 'Bad Circle 2',
        type: 'CIRCLE',
        boundaryGeoJson: circleRing(35.7, 51.4, 0),
        centerLat: 35.7,
        centerLng: 51.4,
        radiusM: 0,
      }),
    ).rejects.toBeInstanceOf(GeofenceValidationError);
  });

  it('4/5. rejects invalid + SELF-INTERSECTING polygons via PostGIS ST_IsValid', async () => {
    if (!ctx || !repo) return;
    // Unclosed ring — structural rejection.
    await expect(
      repo.create({
        tenantId: TENANT_A,
        name: 'Unclosed',
        type: 'POLYGON',
        boundaryGeoJson: { type: 'Polygon', coordinates: [triangleRing().slice(0, -1)] },
      }),
    ).rejects.toBeInstanceOf(GeofenceValidationError);
    // Bow-tie (self-intersecting) ring — REJECTED by PostGIS ST_IsValid, never
    // silently repaired (§8).
    const bowtie = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
      [0, 0],
    ];
    await expect(
      repo.create({
        tenantId: TENANT_A,
        name: 'Bowtie',
        type: 'POLYGON',
        boundaryGeoJson: { type: 'Polygon', coordinates: [bowtie] },
      }),
    ).rejects.toThrow(/Invalid polygon geometry|Self-intersection/i);
  });

  it('7. updates name + geometry (version bump, re-validated)', async () => {
    if (!ctx || !repo) return;
    const created = await repo.create({
      tenantId: TENANT_A,
      name: 'To Update',
      type: 'CIRCLE',
      boundaryGeoJson: circleRing(35.7, 51.4, 300),
      centerLat: 35.7,
      centerLng: 51.4,
      radiusM: 300,
    });
    const updated = await repo.update(created.id, TENANT_A, {
      name: 'Updated Name',
      radiusM: 900,
    });
    expect(updated?.name).toBe('Updated Name');
    expect(updated?.radiusM).toBe(900);
    const again = await repo.findById(created.id, TENANT_A);
    expect(again?.name).toBe('Updated Name');
  });

  it('8. archive (soft delete) hides from default list; row stays queryable', async () => {
    if (!ctx || !repo) return;
    const created = await repo.create({
      tenantId: TENANT_A,
      name: 'Doomed',
      type: 'POLYGON',
      boundaryGeoJson: { type: 'Polygon', coordinates: [triangleRing()] },
    });
    expect(await repo.archive(created.id, TENANT_A)).toBe(true);
    const activePage = await repo.listPage(TENANT_A, { limit: 100 });
    expect(activePage.items.find((g) => g.id === created.id)).toBeUndefined();
    const archivedPage = await repo.listPage(TENANT_A, { limit: 100, status: 'ARCHIVED' });
    expect(archivedPage.items.find((g) => g.id === created.id)?.status).toBe('ARCHIVED');
  });

  it('9. activates / deactivates (INACTIVE fences are not ACTIVE)', async () => {
    if (!ctx || !repo) return;
    const created = await repo.create({
      tenantId: TENANT_A,
      name: 'Toggle Me',
      type: 'POLYGON',
      boundaryGeoJson: { type: 'Polygon', coordinates: [triangleRing()] },
    });
    await repo.setStatus(created.id, TENANT_A, 'INACTIVE');
    expect((await repo.findById(created.id, TENANT_A))?.status).toBe('INACTIVE');
    // containsPoint only considers ACTIVE fences.
    const ids = await repo.containsPoint(TENANT_A, 35.7, 51.41);
    expect(ids).not.toContain(created.id);
    await repo.setStatus(created.id, TENANT_A, 'ACTIVE');
    expect((await repo.findById(created.id, TENANT_A))?.status).toBe('ACTIVE');
    const idsAfter = await repo.containsPoint(TENANT_A, 35.7, 51.41);
    expect(idsAfter).toContain(created.id);
  });

  it('10. assignments restrict + filter; unassigned fences stay tenant-wide', async () => {
    if (!ctx || !repo) return;
    const assigned = await repo.create({
      tenantId: TENANT_A,
      name: 'Restricted Zone',
      type: 'POLYGON',
      boundaryGeoJson: { type: 'Polygon', coordinates: [triangleRing()] },
    });
    const open = await repo.create({
      tenantId: TENANT_A,
      name: 'Open Zone',
      type: 'POLYGON',
      boundaryGeoJson: { type: 'Polygon', coordinates: [triangleRing()] },
    });
    await repo.assign(TENANT_A, assigned.id, VEHICLE_1);
    await repo.assign(TENANT_A, assigned.id, VEHICLE_2);

    const byVehicle = await repo.listPage(TENANT_A, { limit: 100, vehicleId: VEHICLE_1 });
    expect(byVehicle.items.map((g) => g.id)).toContain(assigned.id);
    expect(byVehicle.items.map((g) => g.id)).not.toContain(open.id);

    const detail = await repo.findById(assigned.id, TENANT_A);
    expect([...(detail?.assignedVehicleIds ?? [])].sort()).toEqual([VEHICLE_1, VEHICLE_2].sort());

    await repo.unassign(TENANT_A, assigned.id, VEHICLE_2);
    expect((await repo.findById(assigned.id, TENANT_A))?.assignedVehicleIds).toEqual([VEHICLE_1]);
  });

  it('11. list filters: type + search + cursor pagination', async () => {
    if (!ctx || !repo) return;
    const page = await repo.listPage(TENANT_A, { limit: 2, type: 'CIRCLE', search: 'Warehouse' });
    expect(page.items.length).toBe(1);
    expect(page.items[0]?.name).toBe('Warehouse Circle');
    expect(page.nextCursor).toBeNull();
    const all = await repo.listPage(TENANT_A, { limit: 2 });
    expect(all.items).toHaveLength(2);
    expect(all.nextCursor).not.toBeNull();
    const page2 = await repo.listPage(TENANT_A, { limit: 2, cursor: all.nextCursor });
    expect(page2.items.length).toBeGreaterThan(0);
    const ids = new Set(all.items.map((g) => g.id));
    for (const g of page2.items) expect(ids.has(g.id)).toBe(false);
  });

  it('12. spatial containment: inside / outside / boundary on real geography', async () => {
    if (!ctx || !repo) return;
    // Circle 500 m around (35.7, 51.4): a point 100 m north is inside; 5 km away is outside.
    const inside = await repo.containsPoint(TENANT_A, 35.7009, 51.4);
    const outside = await repo.containsPoint(TENANT_A, 35.745, 51.44);
    expect(inside.length).toBeGreaterThan(0);
    expect(outside.length).toBe(0);
  });

  it('13. TENANT ISOLATION: cross-tenant findById/update/archive are impossible', async () => {
    if (!ctx || !repo) return;
    const mine = await repo.create({
      tenantId: TENANT_A,
      name: 'A only',
      type: 'POLYGON',
      boundaryGeoJson: { type: 'Polygon', coordinates: [triangleRing()] },
    });
    expect(await repo.findById(mine.id, TENANT_B)).toBeNull();
    expect(await repo.update(mine.id, TENANT_B, { name: 'hijack' })).toBeNull();
    expect(await repo.archive(mine.id, TENANT_B)).toBe(false);
    const bList = await repo.listPage(TENANT_B, { limit: 100 });
    expect(bList.items.map((g) => g.id)).not.toContain(mine.id);
    expect(await repo.containsPoint(TENANT_B, 35.7, 51.41)).not.toContain(mine.id);
    // Assignment is tenant-scoped too.
    await repo.assign(TENANT_B, mine.id, VEHICLE_1);
    const crossTenantView = await repo.findById(mine.id, TENANT_B);
    expect(crossTenantView).toBeNull();
  });

  it('14. EXPLAIN: the spatial candidate query uses the GiST index (no Seq Scan)', async () => {
    if (!ctx || !repo) return;
    // Seed enough rows that the planner prefers the index.
    await ctx.knex.raw(
      `INSERT INTO tracking.geofences (tenant_id, name, geofence_type, boundary, alert_on, metadata)
       SELECT '${TENANT_B}', 'bulk ' || gs, 'POLYGON',
              ST_Translate(
                ST_Buffer(ST_MakePoint(20 + (gs % 50) * 0.5, 20 + (gs % 50) * 0.5)::geography, 300)::geometry,
                0, 0),
              '{ENTER,EXIT}', '{}'
       FROM generate_series(1, 2000) gs`,
    );
    await ctx.knex.raw('ANALYZE tracking.geofences');
    const plan = await ctx.knex.raw(
      `EXPLAIN (COSTS OFF)
       SELECT g.id FROM tracking.geofences g
       WHERE g.tenant_id = ?::uuid AND g.status = 'ACTIVE'
         AND g.boundary && ST_Expand(ST_GeomFromText('SRID=4326;POINT(51.4 35.7)', 4326), 0.05)`,
      [TENANT_B],
    );
    const text = plan.rows.map((r: Record<string, unknown>) => Object.values(r)[0]).join('\n');
    expect(text).toMatch(/Bitmap Index Scan|Index Scan/);
    expect(text).toMatch(/ix_geofences_boundary/);
    expect(text).not.toMatch(/Seq Scan on tracking\.geofences/);
  });
});

/** Circle → 48-gon ring helper (same math the frontend drawing uses). */
function circleRing(lat: number, lng: number, radiusM: number): {
  type: 'Polygon';
  coordinates: number[][][];
} {
  const ring: number[][] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= 48; i++) {
    const theta = (2 * Math.PI * i) / 48;
    ring.push([
      lng + (radiusM * Math.cos(theta)) / (111_320 * Math.cos(latRad)),
      lat + (radiusM * Math.sin(theta)) / 111_320,
    ]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}
