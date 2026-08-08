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
  video: {
    all: ['video'] as const,
    channels: () => [...queryKeys.video.all, 'channels'] as const,
    stream: (channelId: string, quality: string) =>
      [...queryKeys.video.all, 'stream', channelId, quality] as const,
    walls: () => [...queryKeys.video.all, 'walls'] as const,
  },
  alarms: {
    all: ['alarms'] as const,
    list: () => [...queryKeys.alarms.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.alarms.all, 'detail', id] as const,
  },
  assets: {
    all: ['assets'] as const,
    vehicles: () => [...queryKeys.assets.all, 'vehicles'] as const,
    vehicleDetail: (id: string) => [...queryKeys.assets.all, 'vehicle', id] as const,
    drivers: () => [...queryKeys.assets.all, 'drivers'] as const,
    driverDetail: (id: string) => [...queryKeys.assets.all, 'driver', id] as const,
    devices: () => [...queryKeys.assets.all, 'devices'] as const,
    deviceDetail: (id: string) => [...queryKeys.assets.all, 'device', id] as const,
    groups: () => [...queryKeys.assets.all, 'groups'] as const,
  },
  reports: {
    all: ['reports'] as const,
    definitions: () => [...queryKeys.reports.all, 'definitions'] as const,
    jobs: () => [...queryKeys.reports.all, 'jobs'] as const,
    kpis: () => [...queryKeys.reports.all, 'kpis'] as const,
    charts: () => [...queryKeys.reports.all, 'charts'] as const,
    dashboards: () => [...queryKeys.reports.all, 'dashboards'] as const,
  },
  admin: {
    all: ['admin'] as const,
    users: () => [...queryKeys.admin.all, 'users'] as const,
    userDetail: (id: string) => [...queryKeys.admin.all, 'user', id] as const,
    roles: () => [...queryKeys.admin.all, 'roles'] as const,
    permissions: () => [...queryKeys.admin.all, 'permissions'] as const,
    settings: () => [...queryKeys.admin.all, 'settings'] as const,
    audit: () => [...queryKeys.admin.all, 'audit'] as const,
  },
} as const;
