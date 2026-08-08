/**
 * Centralized TanStack Query key factory.
 *
 * Keeps query keys stable, typed, and co-located so cache invalidation and
 * dedup are predictable. New feature domains add a sub-object here.
 */
export const queryKeys = {
  fleet: {
    all: ['fleet'] as const,
    stats: () => [...queryKeys.fleet.all, 'stats'] as const,
    activity: (range: string) => [...queryKeys.fleet.all, 'activity', range] as const,
    alerts: () => [...queryKeys.fleet.all, 'alerts'] as const,
    attention: () => [...queryKeys.fleet.all, 'attention'] as const,
    utilization: () => [...queryKeys.fleet.all, 'utilization'] as const,
    mapVehicles: () => [...queryKeys.fleet.all, 'mapVehicles'] as const,
    weather: () => [...queryKeys.fleet.all, 'weather'] as const,
    vehicleDetail: (id: string) => [...queryKeys.fleet.all, 'vehicle', id] as const,
  },
  trips: {
    all: ['trips'] as const,
    list: () => [...queryKeys.trips.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.trips.all, 'detail', id] as const,
    active: () => [...queryKeys.trips.all, 'active'] as const,
  },
} as const;
