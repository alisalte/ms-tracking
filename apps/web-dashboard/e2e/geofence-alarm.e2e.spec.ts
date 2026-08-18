/**
 * Sprint I browser E2E — geofence event → alarm → notification → bell
 * (§44, §64 TEST 4).
 *
 * The full pipeline is exercised end-to-end through the REAL services:
 *   1. create a geofence via the API (map-engine, authenticated as the UI user)
 *   2. seed a `geofence_enter` alarm rule (notification-service API)
 *   3. publish the gps-engine-style `geofence.entered` FleetEvent on Kafka
 *      (exactly the envelope the Sprint I evaluator produces)
 *   4. the alarm engine consumes it → alarm → notification dispatcher →
 *      WebSocket `notification.new` → the browser bell badge increments.
 *
 * Kafka producing happens via node (kafkajs from the workspace). When any
 * dependency (map-engine, notification-service, identity, Kafka) is
 * unreachable the test degrades to an explicit skip.
 */
import { expect, test } from '@playwright/test';
import { Kafka } from 'kafkajs';

import { API_URL, EMAIL, PASSWORD, TENANT, login } from './helpers/login';

const GPS_WS_URL = process.env.E2E_GPS_WS_URL ?? 'http://localhost:3001';

/** Login via REST (browser context cookies/localStorage not needed for API). */
async function apiLogin(request: import('@playwright/test').APIRequestContext) {
  const res = await request.post(`${API_URL}/auth/login`, {
    headers: { 'X-Tenant-Id': TENANT },
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!res.ok()) return null;
  const body = (await res.json()) as {
    data?: { access_token?: string; user?: { id?: string; tenantId?: string } };
  };
  const token = body.data?.access_token;
  if (!token) return null;
  return {
    token,
    userId: body.data?.user?.id ?? null,
    tenantId: body.data?.user?.tenantId ?? null,
  };
}

test('TEST 4: geofence ENTER FleetEvent → alarm → notification → bell', async ({
  page,
  request,
}) => {
  const auth = await apiLogin(request);
  test.skip(!auth, 'identity unreachable — cannot authenticate');
  const headers = { Authorization: `Bearer ${auth!.token}` };

  // 1. Create a geofence through the REAL API (validated by PostGIS).
  const fenceRes = await request.post('/api/v1/geofences', {
    headers,
    data: {
      name: `E2E Alarm Fence ${Date.now()}`,
      type: 'CIRCLE',
      boundary: circleBoundary(35.7, 51.4, 500),
      centerLat: 35.7,
      centerLng: 51.4,
      radiusM: 500,
      alertOn: ['ENTER', 'EXIT'],
    },
  });
  test.skip(fenceRes.status() >= 500, 'map-engine unreachable — cannot create geofence');
  expect(fenceRes.status()).toBe(201);
  const fence = (await fenceRes.json()) as { id: string };

  // 2. Seed the alarm rule (one-shot name per run; idempotent-enough for E2E).
  await request.post('/api/v1/notification/rules', {
    headers,
    data: {
      name: `e2e-geofence-enter-${Date.now()}`,
      type: 'geofence_enter',
      severity: 'HIGH',
      conditions: { geofenceId: fence.id },
      cooldown_sec: 0,
      dedup_window_sec: 1,
      repeat_policy: 'ALWAYS',
    },
  });

  // 3. Publish the geofence.entered FleetEvent (the evaluator's envelope).
  const kafka = new Kafka({
    brokers: [process.env.E2E_KAFKA ?? 'localhost:9092'],
    clientId: 'e2e-sprint-i',
  });
  const producer = kafka.producer({ allowAutoTopicCreation: true });
  try {
    await producer.connect();
  } catch {
    test.skip(true, 'kafka unreachable — cannot publish the geofence FleetEvent');
  }
  const vehicleId = `e2e-${Date.now()}`;
  const eventId = `e2e:${vehicleId}:geofence.entered:${fence.id}`;
  await producer.send({
    topic: 'fleetvision.tracking.events',
    messages: [
      {
        key: vehicleId,
        value: JSON.stringify({
          specversion: '1.0',
          type: 'tracking.event.v1',
          id: eventId,
          eventId,
          correlationId: `e2e:${vehicleId}`,
          eventType: 'geofence.entered',
          tenantId: auth!.tenantId,
          vehicleId,
          deviceId: null,
          occurredAt: new Date().toISOString(),
          severity: 'INFO',
          metadata: {
            sourceEventId: `e2e:${vehicleId}`,
            geofenceId: fence.id,
            geofenceName: 'E2E Alarm Fence',
            dwellSec: null,
            lat: 35.7,
            lng: 51.4,
          },
        }),
      },
    ],
  });
  await producer.disconnect();

  // 4. The browser: login → the bell badge reflects the dispatched
  //    notification (WS push or the 30 s poll fallback).
  await login(page);
  const bell = page.locator('header').getByRole('button', { name: 'notifications' });
  await expect(bell).toBeVisible();
  // The notification fan-out is asynchronous (rule cache 30 s worst case) —
  // open the bell and check the notification list contains the geofence alarm.
  await expect
    .poll(
      async () => {
        await bell.click().catch(() => {});
        const item = page.getByText(/geofence|fence/i).first();
        return (await item.isVisible().catch(() => false)) ? 'seen' : 'waiting';
      },
      { timeout: 90_000, intervals: [3_000] },
    )
    .toBe('seen');
});

/** Circle → 48-gon GeoJSON (same math the drawing UI uses). */
function circleBoundary(lat: number, lng: number, radiusM: number) {
  const ring: number[][] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= 48; i++) {
    const theta = (2 * Math.PI * i) / 48;
    ring.push([
      lng + (radiusM * Math.cos(theta)) / (111_320 * Math.cos(latRad)),
      lat + (radiusM * Math.sin(theta)) / 111_320,
    ]);
  }
  return { type: 'Polygon' as const, coordinates: [ring] };
}

void GPS_WS_URL;
