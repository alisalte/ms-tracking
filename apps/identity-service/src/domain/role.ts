/**
 * Role aggregate — a named bundle of permissions within a tenant. System roles
 * (tenant-admin, fleet-admin, viewer) are seeded at provisioning and are
 * immutable; custom roles are user-created.
 */
import { AggregateRoot, type Brand } from '@fleetvision/shared-kernel';

export interface RoleProps {
  readonly tenantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly permissions: Set<string>;
}

export class Role extends AggregateRoot<Brand<string, 'RoleId'>> {
  private readonly props: RoleProps;

  private constructor(id: string, version: number, props: RoleProps) {
    super(id as Brand<string, 'RoleId'>, version);
    this.props = { ...props, permissions: new Set(props.permissions) };
  }

  /** @deprecated No use-case creates a custom role via this factory yet (Sprint 2). */
  public static create(
    id: string,
    init: { tenantId: string; name: string; description?: string; permissions?: string[] },
  ): Role {
    return new Role(id, 0, {
      tenantId: init.tenantId,
      name: init.name,
      description: init.description ?? null,
      isSystem: false,
      permissions: new Set(init.permissions ?? []),
    });
  }

  /** Seed a system role (immutable — tenant-admin/fleet-admin/viewer). */
  public static seedSystem(
    id: string,
    init: { tenantId: string; name: string; permissions: readonly string[] },
  ): Role {
    return new Role(id, 0, {
      tenantId: init.tenantId,
      name: init.name,
      description: `System role: ${init.name}`,
      isSystem: true,
      permissions: new Set(init.permissions),
    });
  }

  public static rehydrate(id: string, version: number, props: RoleProps): Role {
    return new Role(id, version, props);
  }

  public get tenantId(): string {
    return this.props.tenantId;
  }
  public get name(): string {
    return this.props.name;
  }
  public get description(): string | null {
    return this.props.description;
  }
  public get isSystem(): boolean {
    return this.props.isSystem;
  }
  public get permissions(): ReadonlySet<string> {
    return this.props.permissions;
  }

  /** @deprecated No role-edit use-case wires this yet (Sprint 2). */
  public grant(permission: string): void {
    if (this.props.isSystem) {
      throw new Error('System roles are immutable.');
    }
    this.props.permissions.add(permission);
  }

  /** @deprecated No role-edit use-case wires this yet (Sprint 2). */
  public revoke(permission: string): void {
    if (this.props.isSystem) {
      throw new Error('System roles are immutable.');
    }
    this.props.permissions.delete(permission);
  }
}
