/**
 * Mine operations — device activity and haul cycles.
 *
 * Activity and cycle reports come from reporting-service as raw bodies.
 * Haul route CRUD comes from fleet-management inside the `{ data }` envelope.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiGetRaw, apiPost, apiPut } from './client';

export type ReportPreset = 'today' | 'yesterday' | '7d' | '30d';

export interface DeviceActivityRow {
  deviceId: string;
  imei: string;
  protocol: string;
  status: string;
  vehicleId: string | null;
  vehicleName: string | null;
  vehicleCode: string | null;
  plate: string | null;
  startedAt: string | null;
  fixes: number;
  lastFixAt: string | null;
  offlineSec: number | null;
  distanceKm: number;
  silent: boolean;
}

export interface DeviceActivityReport {
  from: string;
  to: string;
  totalDistanceKm: number;
  silentCount: number;
  reportingCount: number;
  devices: DeviceActivityRow[];
}

export interface HaulRoute {
  id: string;
  name: string;
  originGeofenceId: string;
  destinationGeofenceId: string;
  shiftStartHour: number;
  shiftDurationHours: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface HaulMember {
  id: string;
  deviceId: string;
  role: 'TRUCK' | 'SHOVEL';
  imei: string | null;
}

export interface HaulCycleRow {
  vehicleId: string;
  vehicleName: string;
  shovelId: string | null;
  shovelLabel: string | null;
  driverId: string | null;
  driverName: string | null;
  originEnteredAt: string;
  originLeftAt: string;
  destinationEnteredAt: string;
  loadDwellSec: number;
  travelSec: number;
  durationSec: number;
  distanceKm: number;
  shift: string;
}

export interface HaulCycleReport {
  route: {
    id: string;
    name: string;
    shiftStartHour: number;
    shiftDurationHours: number;
    timeZone: string;
  };
  from: string;
  to: string;
  truncated: boolean;
  services: number;
  distanceKm: number;
  cycles: HaulCycleRow[];
  byVehicle: Array<{
    vehicleId: string;
    vehicleName: string;
    services: number;
    distanceKm: number;
    durationSec: number;
  }>;
  byDriverShift: Array<{
    driverId: string;
    driverName: string;
    shift: string;
    services: number;
    distanceKm: number;
    durationSec: number;
  }>;
  byShovel: Array<{ shovelId: string; shovelLabel: string; loads: number }>;
  openHauls: Array<{
    vehicleId: string;
    vehicleName: string;
    phase: 'LOADING' | 'HAULING';
    since: string;
  }>;
  unbound: Array<{ deviceId: string; imei: string | null; role: 'TRUCK' | 'SHOVEL' }>;
}

export function useDeviceActivity(preset: ReportPreset) {
  return useQuery({
    queryKey: ['reports', 'device-activity', preset],
    queryFn: () => apiGetRaw<DeviceActivityReport>('/reports/device-activity', { preset }),
  });
}

export function useHaulRoutes() {
  return useQuery({
    queryKey: ['haul-routes'],
    queryFn: () => apiGet<HaulRoute[]>('/haul-routes'),
  });
}

export function useHaulMembers(routeId: string | null) {
  return useQuery({
    queryKey: ['haul-routes', routeId, 'members'],
    queryFn: () => apiGet<HaulMember[]>(`/haul-routes/${routeId}/members`),
    enabled: Boolean(routeId),
  });
}

export function useHaulCycles(routeId: string | null, preset: ReportPreset) {
  return useQuery({
    queryKey: ['reports', 'haul-cycles', routeId, preset],
    queryFn: () => apiGetRaw<HaulCycleReport>('/reports/haul-cycles', { routeId, preset }),
    enabled: Boolean(routeId),
  });
}

export function useCreateHaulRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      originGeofenceId: string;
      destinationGeofenceId: string;
      shiftStartHour: number;
      shiftDurationHours: number;
    }) => apiPost<typeof body, HaulRoute>('/haul-routes', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['haul-routes'] }),
  });
}

export function useSetHaulMembers(routeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (members: Array<{ deviceId: string; role: 'TRUCK' | 'SHOVEL' }>) =>
      apiPut<{ members: Array<{ deviceId: string; role: 'TRUCK' | 'SHOVEL' }> }, HaulMember[]>(
        `/haul-routes/${routeId}/members`,
        { members },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['haul-routes', routeId, 'members'] }),
  });
}
