/**
 * Geofencing API + data hooks (Sprint I).
 *
 * **Real backend**: map-engine-service — the full `/geofences` CRUD surface
 * (list w/ filters + cursor pagination, detail, create, update, archive,
 * activate/deactivate, vehicle assignment) plus the legacy
 * `/location/geofences*` routes (kept for backward compatibility).
 *
 * The endpoints require the authenticated principal's tenant — supplied by the
 * API client's request interceptor; a tenant id is NEVER a query/body param.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock, withMockFallback } from '@/lib/mock-gate';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import type { Page } from '@/types/api.types';
import type {
  CreateGeofencePayload,
  Geofence,
  GeofenceListFilters,
  GeofencePage,
  GeofenceStatus,
  GeofenceType,
  UpdateGeofencePayload,
} from '@/types/geofence.types';
import { apiDelete, apiGetRaw, apiPostRaw, apiPutRaw } from './client';

// ── Query keys ───────────────────────────────────────────────────────────────

// Extend the query-keys factory inline (avoid editing query-keys.ts separately).
const geofenceKeys = {
  all: ['geofences'] as const,
  list: (filters?: GeofenceListFilters) => [...geofenceKeys.all, 'list', filters ?? {}] as const,
  detail: (id: string) => [...geofenceKeys.all, 'detail', id] as const,
};

// ── Fetchers ─────────────────────────────────────────────────────────────────

/** GET /geofences — all (unfiltered) geofences for map overlays. */
async function fetchGeofences(): Promise<Geofence[]> {
  // Real mode: errors propagate (the page shows its ErrorState); mock mode
  // falls back to an empty list only when map-engine is unreachable.
  return withMockFallback(
    // map-engine responds RAW (no { data } envelope) — apiGetRaw, like the
    // Sprint F map endpoints. apiGet would unwrap `.data.data` → undefined.
    () => apiGetRaw<Geofence[]>('/location/geofences'),
    () => resolveMock([]),
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** List all geofences (map-overlay shape, unpaginated legacy route). */
export function useGeofences() {
  return useQuery({ queryKey: geofenceKeys.list(), queryFn: fetchGeofences });
}

/** Paginated + filtered geofence list ("Load more", Sprint I §11). */
export function useGeofencesPage(filters: GeofenceListFilters) {
  return useCursorPagination<Geofence>(geofenceKeys.list(filters), async (cursor) => {
    const page = await withMockFallback(
      () =>
        apiGetRaw<GeofencePage>('/geofences', {
          limit: filters.limit ?? 25,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.type ? { type: filters.type } : {}),
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
          ...(cursor ? { cursor } : {}),
        }),
      () => resolveMock({ items: [], nextCursor: null }),
    );
    // Adapt the map-engine page shape ({items}) to the shared Page<T>.
    return { data: page.items, nextCursor: page.nextCursor } satisfies Page<Geofence>;
  });
}

/** Single geofence detail. */
export function useGeofence(id: string | null) {
  return useQuery({
    queryKey: geofenceKeys.detail(id ?? 'none'),
    queryFn: () => apiGetRaw<Geofence>(`/geofences/${id}`),
    enabled: id !== null,
  });
}

/** Create a geofence → POST /geofences (map-engine responds RAW). */
export function useCreateGeofence() {
  const qc = useQueryClient();
  return useMutation<Geofence, Error, CreateGeofencePayload>({
    mutationFn: async (payload) => apiPostRaw<Geofence>('/geofences', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: geofenceKeys.all }),
  });
}

/** Update a geofence (incl. geometry re-draw) → PUT /geofences/:id. */
export function useUpdateGeofence() {
  const qc = useQueryClient();
  return useMutation<Geofence, Error, { id: string; payload: UpdateGeofencePayload }>({
    mutationFn: async ({ id, payload }) => apiPutRaw<Geofence>(`/geofences/${id}`, payload),
    onSuccess: (_data, { id }) => {
      void id;
      qc.invalidateQueries({ queryKey: geofenceKeys.all });
    },
  });
}

/** Archive (soft delete) a geofence → DELETE /geofences/:id. */
export function useArchiveGeofence() {
  const qc = useQueryClient();
  return useMutation<{ archived: boolean }, Error, string>({
    mutationFn: async (id) => apiDelete<{ archived: boolean }>(`/geofences/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: geofenceKeys.all }),
  });
}

/** Hard delete — legacy route (kept from Sprint F/G). */
export function useDeleteGeofence() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDelete(`/location/geofences/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: geofenceKeys.all }),
  });
}

/** Activate / deactivate / archive → POST /geofences/:id/status. */
export function useSetGeofenceStatus() {
  const qc = useQueryClient();
  return useMutation<Geofence, Error, { id: string; status: GeofenceStatus }>({
    mutationFn: async ({ id, status }) =>
      apiPostRaw<Geofence>(`/geofences/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: geofenceKeys.all }),
  });
}

/** Replace the assigned vehicle set → PUT /geofences/:id/vehicles. */
export function useAssignGeofenceVehicles() {
  const qc = useQueryClient();
  return useMutation<Geofence, Error, { id: string; vehicleIds: string[] }>({
    mutationFn: async ({ id, vehicleIds }) =>
      apiPutRaw<Geofence>(`/geofences/${id}/vehicles`, { vehicleIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: geofenceKeys.all }),
  });
}

/** Check which geofences contain a point → GET /location/geofences/contains. */
export function useGeofenceContains() {
  return useMutation<{ geofenceIds: string[] }, Error, { lat: number; lng: number }>({
    mutationFn: async ({ lat, lng }) =>
      apiGetRaw<{ geofenceIds: string[] }>('/location/geofences/contains', { lat, lng }),
  });
}

export type { Geofence, GeofenceListFilters, GeofenceStatus, GeofenceType, Page };
