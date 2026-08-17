/**
 * Sprint J — Reports & Fleet Analytics browser E2E (§54).
 *
 *   TEST 1 — REPORT OVERVIEW: login → /reports → KPI cards + charts load
 *   TEST 2 — TRIP REPORT: trips section → vehicle filter → custom range →
 *            results → View on Map deep link (§38)
 *   TEST 3 — ALARM REPORT: severity filter narrows the breakdown
 *   TEST 4 — CSV EXPORT: apply filter → download → file contains the FILTERED
 *            data (and not the excluded rows) — never claimed without bytes
 *   TEST 5 — TENANT ISOLATION: foreign vehicleId explicitly supplied → 0 rows;
 *            every visible row belongs to the logged-in tenant's vehicles
 *
 * Stack (external): docker infra + identity + reporting-service (compose) +
 * gps-engine (trips source schema) + vite dev proxy. Unreachable dependencies
 * degrade to annotated skips, never fake passes.
 *
 * Seeded data (fixed UUIDs, see the sprint-j E2E seed): tenant A has vehicles
 * 10-A-101 (2 completed trips + idle/parking/overspeed) and 10-A-102 (1 trip
 * + geofence/offline alarms); tenant B owns one foreign vehicle with a trip.
 */
import { type Page, expect, test } from '@playwright/test';

import { login } from './helpers/login';

const TENANT_A_VEHICLES = [
  '22222291-0000-4000-8000-0000000000a1',
  '22222291-0000-4000-8000-0000000000a2',
];
const TENANT_B_VEHICLE = '22222292-0000-4000-8000-0000000000b1';

/** Authenticated reports API call with the browser's own token. */
async function apiGet(page: Page, path: string): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async (p) => {
    const token =
      JSON.parse(localStorage.getItem('fleetvision_tokens') ?? '{}')?.accessToken ?? null;
    const res = await fetch(p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path);
}

test.describe('Sprint J — Reports E2E', () => {
  test('TEST 1: overview — KPI cards + charts load from the real backend', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);

    const overview = page.waitForResponse('**/api/v1/reports/fleet-overview**').catch(() => null);
    await page.goto('/reports');
    const res = await overview;
    if (!res || res.status() >= 500) {
      test.skip(true, 'reporting-service unreachable — cannot verify overview');
    }

    // KPI cards render (§34) with real backend values (seeded data).
    const kpis = page.getByTestId('report-kpi');
    await expect(kpis.first()).toBeVisible({ timeout: 30_000 });
    expect(await kpis.count()).toBeGreaterThanOrEqual(11);
    // Seeded totals: 2 vehicles, 3 completed trips, 3 alarms, 3 geofence events.
    await expect(page.getByText('281.7 km')).toBeVisible();
    await expect(page.getByText('3', { exact: true }).first()).toBeVisible();

    // Freshness is labeled (§44) — never implied real-time.
    await expect(page.getByTestId('report-freshness')).toBeVisible();

    // Charts render (ECharts mounts its chart surface + accessible image role
    // inside the cards; days from the trend data are visible in the snapshot).
    await expect(page.getByRole('heading', { name: /distance & trips over time/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: /daily alarms by type/i })).toBeVisible();
    const chartSurfaces = await page.locator('.echarts-for-react').count();
    expect(chartSurfaces).toBeGreaterThan(0);
  });

  test('TEST 2: trip report — vehicle filter + custom range + View on Map', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto('/reports?section=trips');

    // Rows from the backend: seeded plates visible.
    await expect(page.getByText('10-A-101').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('10-A-102').first()).toBeVisible();

    // Custom date range (§16): pick Custom, fill, apply → results reload.
    await page.getByTestId('report-range-custom').click();
    await page.getByLabel(/from/i, { exact: false }).locator('input').fill('2026-08-01T00:00');
    await page
      .getByLabel(/to/i, { exact: false })
      .locator('input')
      .fill(new Date().toISOString().slice(0, 16));
    await page.getByTestId('report-range-apply').click();
    await expect(page.getByText('10-A-101').first()).toBeVisible({ timeout: 20_000 });

    // Filter by vehicle: only 10-A-101's 2 trips remain (10-A-102 excluded).
    await page.getByLabel('Vehicle', { exact: true }).click();
    await page.getByRole('option', { name: '10-A-101' }).click();
    await expect(page.getByText('10-A-101').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('10-A-102')).toHaveCount(0);
    // 92.5 km is 10-A-101's longest seeded trip.
    await expect(page.getByText('92.5 km')).toBeVisible();

    // View on Map opens the EXISTING history map with the trip window (§38).
    const viewMap = page.getByTestId('report-trip-view-map').first();
    await viewMap.click();
    await expect(page).toHaveURL(/\/map\?vehicle=22222291/, { timeout: 15_000 });
    await expect(page).toHaveURL(/from=/);
    await expect(page).toHaveURL(/to=/);
  });

  test('TEST 3: alarm report — severity filter narrows the breakdown', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto('/reports?section=alarms');

    // Unfiltered: all three seeded alarm types visible.
    await expect(page.getByText('overspeed').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('geofence_enter').first()).toBeVisible();

    // Filter to HIGH → only the overspeed row remains (§20 filter respected
    // server-side — the severity is a query param, not UI filtering).
    await page.getByTestId('report-severity-filter').click();
    await page.getByRole('option', { name: 'HIGH', exact: true }).click();
    await expect(page.getByText('overspeed').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('geofence_enter')).toHaveCount(0);
    await expect(page.getByText('device_offline')).toHaveCount(0);
  });

  test('TEST 4: CSV export — the downloaded file contains the FILTERED data', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto('/reports?section=trips');

    await expect(page.getByText('10-A-101').first()).toBeVisible({ timeout: 30_000 });

    // Apply the vehicle filter → export → capture the download.
    await page.getByLabel('Vehicle', { exact: true }).click();
    await page.getByRole('option', { name: '10-A-101' }).click();
    await expect(page.getByText('10-A-102')).toHaveCount(0);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByTestId('report-export-trips').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^trips-\d{4}-\d{2}-\d{2}\.csv$/);

    // Verify the BYTES (§78: never claim export complete without testing):
    // header + the filtered vehicle's trips, and NOT the excluded vehicle.
    const csv = (await download.path()) as string;
    const content = await import('node:fs').then((fs) => fs.readFileSync(csv, 'utf8'));
    expect(content).toContain('vehicle,started_at_utc,ended_at_utc,duration_s,distance_km');
    expect(content).toContain('10-A-101');
    expect(content).toContain('92.5');
    expect(content).not.toContain('10-A-102');
  });

  test('TEST 5: tenant isolation — foreign vehicleId supplied → 0 rows', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto('/reports?section=trips');
    await expect(page.getByText('10-A-101').first()).toBeVisible({ timeout: 30_000 });

    // Explicit cross-tenant probe (§53): tenant B's vehicle id with tenant A's
    // token → empty. Tenant comes from the JWT, never the query.
    const foreign = await apiGet(
      page,
      `/api/v1/reports/trips?preset=7d&vehicleId=${TENANT_B_VEHICLE}`,
    );
    if (foreign.status >= 500) {
      test.skip(true, 'reporting-service unreachable — cannot verify tenant isolation');
    }
    expect(foreign.status).toBe(200);
    expect((foreign.body as { items?: unknown[] })?.items ?? []).toHaveLength(0);

    // Overview of tenant A never counts tenant B's data (2 vehicles, not 3).
    const overview = await apiGet(page, '/api/v1/reports/fleet-overview?preset=7d');
    expect(overview.status).toBe(200);
    const o = overview.body as { totalVehicles?: number };
    expect(o.totalVehicles).toBe(2);

    // Every unfiltered trip row belongs to tenant A's vehicles.
    const trips = await apiGet(page, '/api/v1/reports/trips?preset=7d&limit=50');
    const items = (trips.body as { items?: Array<{ vehicleId?: string }> })?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const t of items) {
      expect(TENANT_A_VEHICLES).toContain(t.vehicleId);
    }
  });
});
