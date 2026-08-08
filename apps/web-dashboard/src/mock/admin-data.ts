/**
 * Static mock admin data — the Admin Panel's single demo source.
 *
 * Roles + the permission catalog mirror the canonical system roles and the
 * 14-domain permission catalog (`02_Domain_Model.md` §6) verbatim. Users and
 * audit entries are generated deterministically to cover all statuses/actions.
 * When the `identity-service` (`/api/v1/iam`) + `audit-log-service`
 * (`/api/v1/audit`) endpoints land, `api/admin.api.ts` swaps these constants
 * for `apiGet` calls + wire→camelCase mapping — the types and UI stay unchanged.
 */
import type {
  AdminUser,
  AdminUserStatus,
  AuditAction,
  AuditActorType,
  AuditCategory,
  AuditEntry,
  AuthProvider,
  PermissionGroup,
  Role,
  TenantSettings,
} from '@/types/admin.types';

/** Tiny deterministic PRNG (mulberry32) — no Math.random so tests are stable. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Permission catalog (02_Domain_Model §6.1) ────────────────────────────────

/** The canonical permission catalog grouped by domain (§6.1). */
export const PERMISSION_CATALOG: PermissionGroup[] = [
  {
    domain: 'iam',
    labelKey: 'admin.permissions.domain.iam',
    permissions: [
      'iam.user.read',
      'iam.user.create',
      'iam.user.update',
      'iam.user.manage',
      'iam.role.read',
      'iam.role.create',
      'iam.role.update',
      'iam.role.delete',
      'iam.role.assign',
      'iam.role.revoke',
      'iam.org.read',
      'iam.org.create',
      'iam.org.update',
      'iam.org.manage',
      'iam.apikey.read',
      'iam.apikey.create',
      'iam.apikey.revoke',
      'iam.permission.read',
    ],
  },
  {
    domain: 'fleet',
    labelKey: 'admin.permissions.domain.fleet',
    permissions: [
      'fleet.vehicle.read',
      'fleet.vehicle.create',
      'fleet.vehicle.update',
      'fleet.vehicle.delete',
      'fleet.vehicle.manage',
      'fleet.vehicle.export',
      'fleet.fleet.read',
      'fleet.fleet.create',
      'fleet.fleet.update',
      'fleet.fleet.delete',
      'fleet.policy.read',
      'fleet.policy.update',
    ],
  },
  {
    domain: 'tracking',
    labelKey: 'admin.permissions.domain.tracking',
    permissions: [
      'tracking.position.read',
      'tracking.position.live',
      'tracking.history.read',
      'tracking.session.read',
      'tracking.geofence.read',
      'tracking.geofence.create',
      'tracking.geofence.update',
      'tracking.geofence.delete',
      'tracking.alert.read',
      'tracking.replay.read',
    ],
  },
  {
    domain: 'media',
    labelKey: 'admin.permissions.domain.media',
    permissions: [
      'media.channel.read',
      'media.channel.manage',
      'media.video.read',
      'media.video.live',
      'media.video.export',
      'media.video.manage',
      'media.policy.read',
      'media.policy.manage',
      'media.ai.read',
      'media.wall.read',
      'media.wall.manage',
    ],
  },
  {
    domain: 'driver',
    labelKey: 'admin.permissions.domain.driver',
    permissions: [
      'driver.profile.read',
      'driver.profile.create',
      'driver.profile.update',
      'driver.profile.deactivate',
      'driver.profile.manage',
      'driver.license.read',
      'driver.license.manage',
      'driver.certification.read',
      'driver.certification.manage',
      'driver.behavior.read',
      'driver.assignment.read',
      'driver.assignment.create',
      'driver.assignment.revoke',
    ],
  },
  {
    domain: 'trip',
    labelKey: 'admin.permissions.domain.trip',
    permissions: [
      'trip.read',
      'trip.create',
      'trip.update',
      'trip.dispatch',
      'trip.cancel',
      'trip.divert',
      'trip.export',
      'trip.own.read',
      'trip.own.update',
      'trip.pod.submit',
      'trip.pod.read',
      'trip.route.read',
      'trip.route.create',
      'trip.route.optimize',
    ],
  },
  {
    domain: 'maintenance',
    labelKey: 'admin.permissions.domain.maintenance',
    permissions: [
      'maintenance.workorder.read',
      'maintenance.workorder.create',
      'maintenance.workorder.update',
      'maintenance.workorder.submit',
      'maintenance.workorder.approve',
      'maintenance.workorder.assign',
      'maintenance.workorder.execute',
      'maintenance.workorder.close',
      'maintenance.workorder.cancel',
      'maintenance.plan.read',
      'maintenance.plan.create',
      'maintenance.plan.update',
      'maintenance.parts.read',
      'maintenance.parts.update',
      'maintenance.vendor.read',
      'maintenance.vendor.create',
      'maintenance.vendor.update',
    ],
  },
  {
    domain: 'compliance',
    labelKey: 'admin.permissions.domain.compliance',
    permissions: [
      'compliance.hos.read',
      'compliance.hos.certify',
      'compliance.hos.manage',
      'compliance.dvir.read',
      'compliance.dvir.submit',
      'compliance.incident.read',
      'compliance.incident.report',
      'compliance.incident.investigate',
      'compliance.incident.resolve',
      'compliance.report.generate',
      'compliance.report.export',
    ],
  },
  {
    domain: 'fuel',
    labelKey: 'admin.permissions.domain.fuel',
    permissions: [
      'fuel.card.read',
      'fuel.card.issue',
      'fuel.card.suspend',
      'fuel.card.reactivate',
      'fuel.transaction.read',
      'fuel.transaction.export',
    ],
  },
  {
    domain: 'telemetry',
    labelKey: 'admin.permissions.domain.telemetry',
    permissions: [
      'telemetry.device.read',
      'telemetry.device.create',
      'telemetry.device.update',
      'telemetry.device.manage',
      'telemetry.device.provision',
      'telemetry.command.send',
      'telemetry.command.read',
      'telemetry.firmware.read',
      'telemetry.firmware.create',
      'telemetry.firmware.update',
      'telemetry.firmware.manage',
      'telemetry.gateway.read',
      'telemetry.gateway.manage',
      'telemetry.data.read',
    ],
  },
  {
    domain: 'asset',
    labelKey: 'admin.permissions.domain.asset',
    permissions: [
      'asset.vehicle.read',
      'asset.vehicle.manage',
      'asset.depreciation.read',
      'asset.depreciation.manage',
    ],
  },
  {
    domain: 'analytics',
    labelKey: 'admin.permissions.domain.analytics',
    permissions: [
      'analytics.dashboard.read',
      'analytics.dashboard.manage',
      'analytics.report.read',
      'analytics.report.generate',
      'analytics.report.schedule',
      'analytics.report.export',
    ],
  },
  {
    domain: 'notification',
    labelKey: 'admin.permissions.domain.notification',
    permissions: [
      'notification.alert.read',
      'notification.alert.ack',
      'notification.alert.manage',
      'notification.rule.read',
      'notification.rule.manage',
    ],
  },
  {
    domain: 'billing',
    labelKey: 'admin.permissions.domain.billing',
    permissions: [
      'billing.tenant.read',
      'billing.tenant.manage',
      'billing.subscription.read',
      'billing.subscription.manage',
      'billing.invoice.read',
      'billing.invoice.generate',
      'billing.usage.read',
    ],
  },
  {
    domain: 'audit',
    labelKey: 'admin.permissions.domain.audit',
    permissions: ['audit.read', 'audit.export', 'audit.retention.manage'],
  },
];

/** Flatten the catalog to all permission keys (for the wildcard role). */
function allPermissionKeys(): string[] {
  return PERMISSION_CATALOG.flatMap((g) => g.permissions);
}

/** All read permissions (for the viewer role). */
function allReadKeys(): string[] {
  return allPermissionKeys().filter((p) => p.endsWith('.read'));
}

// ── System roles (02_Domain_Model §6.2) ──────────────────────────────────────

/** Build the 9 system roles + 2 custom roles (§6.2). */
function buildRoles(): Role[] {
  const domainKeys = (domain: string) =>
    allPermissionKeys().filter((p) => p.startsWith(`${domain}.`));
  return [
    {
      id: 'role-tenant-admin',
      name: 'Tenant Admin',
      description: 'Full platform access',
      isSystem: true,
      permissionKeys: allPermissionKeys(),
      memberCount: 2,
      mfaRequired: true,
    },
    {
      id: 'role-compliance',
      name: 'Compliance Officer',
      description: 'Compliance + tracking oversight',
      isSystem: true,
      permissionKeys: [
        ...domainKeys('compliance'),
        ...domainKeys('tracking'),
        ...domainKeys('audit'),
      ],
      memberCount: 1,
      mfaRequired: true,
    },
    {
      id: 'role-fleet-admin',
      name: 'Fleet Admin',
      description: 'Fleet, drivers, trips, maintenance',
      isSystem: true,
      permissionKeys: [
        ...domainKeys('fleet'),
        ...domainKeys('driver'),
        ...domainKeys('trip'),
        ...domainKeys('maintenance'),
      ],
      memberCount: 3,
      mfaRequired: false,
    },
    {
      id: 'role-dispatcher',
      name: 'Dispatcher',
      description: 'Trips, live tracking, driver lookup',
      isSystem: true,
      permissionKeys: [
        ...domainKeys('trip'),
        'tracking.position.live',
        'driver.profile.read',
        'fleet.vehicle.read',
      ],
      memberCount: 7,
      mfaRequired: false,
    },
    {
      id: 'role-fleet-operator',
      name: 'Fleet Operator',
      description: 'Vehicle updates, driver/trip read',
      isSystem: true,
      permissionKeys: [
        'fleet.vehicle.read',
        'fleet.vehicle.update',
        'driver.profile.read',
        'trip.read',
      ],
      memberCount: 4,
      mfaRequired: false,
    },
    {
      id: 'role-mechanic',
      name: 'Mechanic',
      description: 'Maintenance + vehicle read',
      isSystem: true,
      permissionKeys: [...domainKeys('maintenance'), 'fleet.vehicle.read'],
      memberCount: 5,
      mfaRequired: false,
    },
    {
      id: 'role-finance',
      name: 'Finance',
      description: 'Billing + asset financials',
      isSystem: true,
      permissionKeys: [...domainKeys('billing'), ...domainKeys('asset')],
      memberCount: 2,
      mfaRequired: false,
    },
    {
      id: 'role-driver',
      name: 'Driver',
      description: 'Own trips + HOS/DVIR',
      isSystem: true,
      permissionKeys: [
        'trip.own.read',
        'trip.own.update',
        'compliance.hos.read',
        'compliance.dvir.read',
        'compliance.dvir.submit',
      ],
      memberCount: 12,
      mfaRequired: false,
    },
    {
      id: 'role-viewer',
      name: 'Viewer',
      description: 'Read-only across the platform',
      isSystem: true,
      permissionKeys: allReadKeys(),
      memberCount: 3,
      mfaRequired: false,
    },
    // Custom roles
    {
      id: 'role-night-driver',
      name: 'Night Driver',
      description: 'Custom: night-shift drivers with extended HOS',
      isSystem: false,
      permissionKeys: [
        'trip.own.read',
        'trip.own.update',
        'compliance.hos.read',
        'compliance.dvir.read',
      ],
      memberCount: 6,
      mfaRequired: false,
    },
    {
      id: 'role-safety-coach',
      name: 'Safety Coach',
      description: 'Custom: driver behavior review + coaching',
      isSystem: false,
      permissionKeys: [
        'driver.profile.read',
        'driver.behavior.read',
        'media.video.read',
        'media.ai.read',
        'analytics.report.read',
      ],
      memberCount: 2,
      mfaRequired: false,
    },
  ];
}

export const mockRoles: Role[] = buildRoles();

// ── Users (IAM §3.1) ─────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'John',
  'Mei',
  'Ana',
  'Tom',
  'Sara',
  'David',
  'Lena',
  'Omar',
  'Priya',
  'Carlos',
  'Yuki',
  'Nadia',
  'Erik',
  'Grace',
  'Bilal',
];
const LAST_NAMES = [
  'Doe',
  'Chen',
  'Ruiz',
  'Keita',
  'Ahmadi',
  'Costa',
  'Müller',
  'Hassan',
  'Singh',
  'Vega',
  'Tanaka',
  'Rezai',
  'Larsson',
  'Park',
  'Khan',
];
const USER_ROLES = [
  'role-tenant-admin',
  'role-fleet-admin',
  'role-dispatcher',
  'role-mechanic',
  'role-finance',
  'role-driver',
  'role-viewer',
  'role-compliance',
  'role-safety-coach',
];
const STATUSES: AdminUserStatus[] = [
  'active',
  'active',
  'active',
  'suspended',
  'deactivated',
  'locked',
];
const PROVIDERS: AuthProvider[] = ['local', 'sso', 'scim'];

function buildUsers(): AdminUser[] {
  const rand = seeded(20260815);
  const now = Date.now();
  return FIRST_NAMES.map((first, i) => {
    const last = LAST_NAMES[i] ?? 'User';
    const roleId = USER_ROLES[i % USER_ROLES.length] ?? 'role-viewer';
    const role = mockRoles.find((r) => r.id === roleId);
    const status = STATUSES[i % STATUSES.length] ?? 'active';
    return {
      id: `usr-${1000 + i}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@acme.com`,
      username: `${first[0]}${last}`.toLowerCase(),
      firstName: first,
      lastName: last,
      status,
      roleIds: [roleId],
      roleName: role?.name ?? 'Viewer',
      mfaEnabled: role?.mfaRequired ?? rand() > 0.6,
      lastLoginAt:
        status === 'active'
          ? new Date(now - Math.floor(rand() * 7 * 86_400_000)).toISOString()
          : undefined,
      authProvider: PROVIDERS[i % PROVIDERS.length] ?? 'local',
      createdAt: new Date(now - Math.floor(rand() * 365 * 86_400_000)).toISOString(),
    };
  });
}

export const mockUsers: AdminUser[] = buildUsers();

/** Resolve a single user by id (mirrors the detail endpoint). */
export function mockUserDetail(id: string): AdminUser | undefined {
  return mockUsers.find((u) => u.id === id);
}

// ── Tenant settings (UI_UX §5.2) ─────────────────────────────────────────────

export const mockSettings: TenantSettings = {
  locale: 'en',
  timezone: 'Asia/Tehran',
  distanceUnit: 'km',
  volumeUnit: 'L',
  tempUnit: 'C',
  dateFormat: 'YYYY-MM-DD',
  orgName: 'Acme Fleet',
  retentionDays: 90,
};

// ── Audit entries (Audit §3.1) ───────────────────────────────────────────────

const ACTIONS: AuditAction[] = [
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'authorize',
  'deny',
  'export',
  'config_change',
  'system',
];
const CATEGORIES: AuditCategory[] = [
  'authentication',
  'authorization',
  'fleet',
  'vehicle',
  'driver',
  'trip',
  'fuel',
  'maintenance',
  'compliance',
  'billing',
  'tenant',
  'system',
];
const ACTOR_TYPES: AuditActorType[] = ['user', 'service', 'system'];
const SERVICES = [
  'identity-service',
  'fleet-service',
  'tracking-service',
  'notification-service',
  'reporting-service',
  'media-service',
];
const TARGET_TYPES = [
  'User',
  'Vehicle',
  'Driver',
  'Trip',
  'Role',
  'Policy',
  'Device',
  'Report',
  'Geofence',
];

function buildAuditEntries(): AuditEntry[] {
  const rand = seeded(20260816);
  const now = Date.now();
  let prevHash = '';
  const entries: AuditEntry[] = [];
  for (let i = 0; i < 30; i++) {
    const action = ACTIONS[i % ACTIONS.length] ?? 'read';
    const category = CATEGORIES[i % CATEGORIES.length] ?? 'system';
    const actorType = ACTOR_TYPES[i % ACTOR_TYPES.length] ?? 'system';
    const user = mockUsers[i % mockUsers.length];
    if (!user) throw new Error('no user');
    const ts = new Date(now - i * 45 * 60_000).toISOString();
    // Fake SHA-256 chain hash (deterministic, not real crypto — for the UI).
    const seedStr = `${ts}${action}${category}${prevHash}`;
    let hash = 0;
    for (let c = 0; c < seedStr.length; c++) hash = (hash * 31 + seedStr.charCodeAt(c)) | 0;
    const integrityHash = `sha256:${Math.abs(hash).toString(16).padStart(8, '0')}${Math.abs(
      hash * 17,
    )
      .toString(16)
      .padStart(8, '0')}`;
    prevHash = integrityHash;
    entries.push({
      id: `aud-${8000 + i}`,
      timestamp: ts,
      action,
      category,
      actorName:
        actorType === 'user'
          ? `${user.firstName} ${user.lastName}`
          : actorType === 'service'
            ? (SERVICES[i % SERVICES.length] ?? 'system')
            : 'system',
      actorType,
      targetType: TARGET_TYPES[i % TARGET_TYPES.length] ?? 'System',
      targetId: `${TARGET_TYPES[i % TARGET_TYPES.length]?.toLowerCase()}-${100 + i}`,
      sourceService: SERVICES[i % SERVICES.length] ?? 'system',
      ipAddress:
        actorType === 'user'
          ? `10.0.${Math.floor(rand() * 255)}.${Math.floor(rand() * 255)}`
          : undefined,
      correlationId: `corr-${i.toString(16).padStart(4, '0')}-${Math.abs(hash).toString(16).slice(0, 8)}`,
      integrityHash,
    });
  }
  return entries;
}

export const mockAuditEntries: AuditEntry[] = buildAuditEntries();
