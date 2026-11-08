/**
 * Driver photos API — fleet-management (`/api/v1/driver-photos`).
 *
 *   GET    /driver-photos                 ?matchStatus&driverId&vehicleId&readyOnly&before&limit
 *                                          → { data: DriverPhoto[], nextBefore }
 *   GET    /driver-photos/counts          → { data: DriverPhotoCounts }
 *   GET    /driver-photos/faces           → { data: DriverFace[] }  per-driver enrolment
 *   GET    /driver-photos/:id/image       image/jpeg
 *   PUT    /driver-photos/:id/driver      { driverId | null } → { data: { rematched } }
 *   DELETE /driver-photos/:id             204
 *   POST   /driver-photos/capture         { deviceId } → { data: { id } }
 *
 * The cabin camera takes a snapshot when a machine's ignition comes on; an
 * operator files each snapshot under a driver, and once a driver has filed
 * photos the platform recognises them by itself.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiDeleteNoContent, apiGet, apiGetBlob, apiGetRaw, apiPost, apiPut } from './client';

export type DriverPhotoStatus = 'PENDING' | 'CAPTURING' | 'DOWNLOADING' | 'READY' | 'FAILED';
export type DriverFaceStatus = 'PENDING' | 'FOUND' | 'NO_FACE' | 'ERROR';
export type DriverMatchStatus = 'UNASSIGNED' | 'AUTO' | 'CONFIRMED';

export interface DriverPhoto {
  id: string;
  deviceId: string;
  deviceImei: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  trigger: 'IGNITION' | 'CONNECT' | 'MANUAL';
  triggeredAt: string;
  capturedAt: string | null;
  status: DriverPhotoStatus;
  error: string | null;
  faceStatus: DriverFaceStatus | null;
  faceScore: number | null;
  driverId: string | null;
  driverName: string | null;
  matchStatus: DriverMatchStatus;
  matchScore: number | null;
  matchedAt: string | null;
}

export interface DriverPhotoCounts {
  unassigned: number;
  auto: number;
  confirmed: number;
  inProgress: number;
  failed: number;
}

/** A driver's face enrolment (only drivers with at least one filed photo are listed). */
export interface DriverFace {
  driverId: string;
  /** Confirmed photos with a face — 1+ means the platform recognises this driver. */
  references: number;
  /** Photos that still have an image (the platform keeps the newest 5). */
  photos: number;
  profilePhotoId: string | null;
}

export interface DriverPhotoFilters {
  matchStatus?: DriverMatchStatus;
  driverId?: string;
  readyOnly?: boolean;
  /** Page size (default 48). */
  limit?: number;
}

const PAGE = 48;
const ROOT = ['driver-photos'] as const;

export const driverPhotoKeys = {
  all: ROOT,
  list: (f: DriverPhotoFilters) => [...ROOT, 'list', f] as const,
  counts: () => [...ROOT, 'counts'] as const,
  faces: () => [...ROOT, 'faces'] as const,
  image: (id: string) => [...ROOT, 'image', id] as const,
};

interface ListPage {
  data: DriverPhoto[];
  nextBefore: string | null;
}

/** Newest first, paged by capture time; refreshes while snapshots are in flight. */
export function useDriverPhotos(filters: DriverPhotoFilters) {
  return useInfiniteQuery({
    queryKey: driverPhotoKeys.list(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiGetRaw<ListPage>('/driver-photos', {
        matchStatus: filters.matchStatus,
        driverId: filters.driverId,
        readyOnly: filters.readyOnly ? 'true' : undefined,
        before: pageParam ?? undefined,
        limit: filters.limit ?? PAGE,
      }),
    getNextPageParam: (last) => last.nextBefore,
    refetchInterval: (query) => {
      const busy = query.state.data?.pages.some((p) =>
        p.data.some(
          (row) =>
            row.status === 'PENDING' ||
            row.status === 'CAPTURING' ||
            row.status === 'DOWNLOADING' ||
            (row.status === 'READY' && row.faceStatus === 'PENDING'),
        ),
      );
      return busy ? 5_000 : 60_000;
    },
  });
}

export function useDriverPhotoCounts() {
  return useQuery({
    queryKey: driverPhotoKeys.counts(),
    queryFn: () => apiGet<DriverPhotoCounts>('/driver-photos/counts'),
    refetchInterval: 30_000,
  });
}

/** Face enrolment per driver, keyed by driver id. */
export function useDriverFaces() {
  return useQuery({
    queryKey: driverPhotoKeys.faces(),
    queryFn: async () => {
      const rows = await apiGet<DriverFace[]>('/driver-photos/faces');
      return new Map(rows.map((r) => [r.driverId, r] as const));
    },
    staleTime: 30_000,
  });
}

/** Object URL of one snapshot (fetched with the session's bearer token). */
export function useDriverPhotoImage(id: string, enabled: boolean) {
  return useQuery({
    queryKey: driverPhotoKeys.image(id),
    queryFn: async () => URL.createObjectURL(await apiGetBlob(`/driver-photos/${id}/image`)),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
  });
}

export function useAssignDriverPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; driverId: string | null }) =>
      apiPut<{ driverId: string | null }, { rematched: number }>(
        `/driver-photos/${input.id}/driver`,
        { driverId: input.driverId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...ROOT, 'list'] });
      void qc.invalidateQueries({ queryKey: driverPhotoKeys.counts() });
      void qc.invalidateQueries({ queryKey: driverPhotoKeys.faces() });
    },
  });
}

export function useDeleteDriverPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDeleteNoContent(`/driver-photos/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...ROOT, 'list'] });
      void qc.invalidateQueries({ queryKey: driverPhotoKeys.counts() });
      void qc.invalidateQueries({ queryKey: driverPhotoKeys.faces() });
    },
  });
}

export function useCaptureDriverPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) =>
      apiPost<{ deviceId: string }, { id: string }>('/driver-photos/capture', { deviceId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...ROOT, 'list'] });
      void qc.invalidateQueries({ queryKey: driverPhotoKeys.counts() });
      void qc.invalidateQueries({ queryKey: driverPhotoKeys.faces() });
    },
  });
}
