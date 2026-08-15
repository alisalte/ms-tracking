/**
 * Geofencing API + data hooks.
 *
 * **Real backend**: map-engine-service — `GET/POST/DELETE /location/geofences`
 * and `GET /location/geofences/contains`. These endpoints are fully implemented
 * in the backend (PostGIS-backed CRUD + spatial query).
 *
 * The map-engine-service runs on its own port (not yet in docker-compose), so
 * in dev the fetchers try the real API and fall back to an empty list on
 * network error. In production, mocks are excluded entirely.
 *
 * The endpoints require a `tenant-id` header — supplied by the API client's
 * request interceptor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock, withMockFallback } from '@/lib/mock-gate';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import type { Page } from '@/types/api.types';
import type { CreateGeofencePayload, Geofence, GeofenceType } from '@/types/geofence.types';
import { apiDelete, apiGet, apiPost } from './client';

// ── Query keys ───────────────────────────────────────────────────────────────

// Extend the query-keys factory inline (avoid editing query-keys.ts separately).
const geofenceKeys = {
  all: ['geofences'] as const,
  list: () => [...geofenceKeys.all, 'list'] as const,
};

// ── Fetchers ─────────────────────────────────────────────────────────────────

/** GET /location/geofences — list all geofences for the tenant. */
async function fetchGeofences(): Promise<Geofence[]> {
  // Real mode: errors propagate (the page shows its ErrorState); mock mode
  // falls back to an empty list only when map-engine is unreachable.
  return withMockFallback(
    () => apiGet<Geofence[]>('/location/geofences'),
    () => resolveMock([]),
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** List all geofences. */
export function useGeofences() {
  return useQuery({ queryKey: geofenceKeys.list(), queryFn: fetchGeofences });
}

/**
 * Cursor-paginated geofences list (real backend: GET /location/geofences?limit=&cursor=).
 * Falls back to empty on network error in dev.
 */
export function useGeofencesPage() {
  return useCursorPagination<Geofence>(geofenceKeys.list(), async (cursor) =>
    withMockFallback(
      () =>
        apiGet<Page<Geofence>>('/location/geofences', {
          limit: 25,
          ...(cursor ? { cursor } : {}),
        }),
      () => resolveMock({ data: [], nextCursor: null }),
    ),
  );
}

/** Create a geofence → POST /location/geofences. */
export function useCreateGeofence() {
  const qc = useQueryClient();
  return useMutation<Geofence, Error, CreateGeofencePayload>({
    mutationFn: async (payload) =>
      apiPost<CreateGeofencePayload, Geofence>('/location/geofences', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: geofenceKeys.all }),
  });
}

/** Delete a geofence → DELETE /location/geofences/:id. */
export function useDeleteGeofence() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    // Awaited (not voided) so real failures surface to the caller's toast —
    // a silent fire-and-forget would fake success when the backend errors.
    mutationFn: (id) => apiDelete(`/location/geofences/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: geofenceKeys.all }),
  });
}

/** Check which geofences contain a point → GET /location/geofences/contains. */
export function useGeofenceContains() {
  return useMutation<{ geofenceIds: string[] }, Error, { lat: number; lng: number }>({
    mutationFn: async ({ lat, lng }) =>
      apiGet<{ geofenceIds: string[] }>('/location/geofences/contains', { lat, lng }),
  });
}

export type { Geofence, GeofenceType };
