/**
 * Bootstrap seed — provisions the first tenant + admin from SEED_* env on
 * startup, idempotently. Runs after migrations succeed. Skipped if a tenant
 * with the seeded admin email already exists.
 *
 * This is how the MVP bootstraps a login-able system without a separate CLI.
 */
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { ProvisionTenantUseCase } from '../../application/index.js';
import type { IdentityConfig } from '../../config/identity.config.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { UserRepository } from '../../infrastructure/persistence/user.repository.js';

export class BootstrapSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger('BootstrapSeed');
  constructor(
    private readonly provision: ProvisionTenantUseCase,
    private readonly users: UserRepository,
    private readonly tenants: TenantRepository,
    private readonly config: IdentityConfig,
  ) {
    void this.tenants; // reserved for future tenant-existence checks
  }

  public async onApplicationBootstrap(): Promise<void> {
    try {
      // Idempotent: skip if any tenant already exists (first tenant = seed).
      // A cheap heuristic: look up the seeded admin username platform-wide.
      const existing = await this.users.findByUsername(this.config.SEED_ADMIN_EMAIL);
      if (existing) {
        this.logger.log('Seed already present — skipping bootstrap.');
        return;
      }
      this.logger.log(`Seeding tenant "${this.config.SEED_TENANT_NAME}" + admin...`);
      await this.provision.execute({
        name: this.config.SEED_TENANT_NAME,
        tier: 'STANDARD',
        region: 'local',
        adminEmail: this.config.SEED_ADMIN_EMAIL,
        adminUsername: this.config.SEED_ADMIN_EMAIL,
        adminPassword: this.config.SEED_ADMIN_PASSWORD,
      });
      this.logger.log('Seed complete.');
    } catch (err) {
      // Non-fatal: the app still boots; an operator can provision manually.
      this.logger.error(`Bootstrap seed failed: ${(err as Error).message}`);
    }
  }
}
