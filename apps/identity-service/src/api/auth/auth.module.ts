// Sprint B: auth primitives (JWT/API-key guards, RBAC, revocation, permission
// catalog) now live in the shared @fleetvision/auth package. identity imports
// it here; the global CompositeAuthGuard + PermissionsGuard it registers secure
// every HTTP route. This module owns only identity-specific feature wiring
// (repositories, cache stores, TokenService, use-cases, controllers).
import { RevocationStore, AuthModule as SharedAuthModule } from '@fleetvision/auth';
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import type { Knex } from '@fleetvision/persistence-knex';
import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AssignRoleUseCase,
  CreateApiKeyUseCase,
  CreateUserUseCase,
  LoginUseCase,
  LogoutUseCase,
  ProvisionTenantUseCase,
  RefreshTokenUseCase,
  RevokeApiKeyUseCase,
  UpdateUserUseCase,
} from '../../application/index.js';
import type { IdentityConfig } from '../../config/identity.config.js';
import {
  ApiKeyRepository,
  AuditRepository,
  AuthRepository,
  PasswordHasher,
  RateLimiterStore,
  RefreshStore,
  RoleRepository,
  SessionStore,
  TenantRepository,
  TokenService,
  UserRepository,
} from '../../infrastructure/index.js';
import { KafkaOutboxRelay } from '../../infrastructure/index.js';
import { UsersController } from '../iam/users.controller.js';
import { BootstrapSeed } from '../shared/bootstrap-seed.js';
import { TenantsController } from '../tenants/tenants.controller.js';
import { ApiKeysController } from './api-keys.controller.js';
import { AuthController } from './auth.controller.js';

function parseTtlSeconds(s: string): number {
  // Accept "900s" or "900".
  const m = /^(\d+)s?$/.exec(s);
  return m ? Number(m[1]) : Number(s);
}

@Module({})
export class AuthModule {
  public static forRoot(config: IdentityConfig) {
    const accessTtl = parseTtlSeconds(config.JWT_ACCESS_TTL);
    const refreshTtl = parseTtlSeconds(config.JWT_REFRESH_TTL);

    return {
      module: AuthModule,
      imports: [
        // Brings JwtModule, the global CompositeAuthGuard + PermissionsGuard, the
        // shared Redis-backed RevocationStore, and the KnexApiKeyVerifier.
        SharedAuthModule.forRoot({
          jwt: {
            JWT_SECRET: config.JWT_SECRET,
            JWT_ISSUER: config.JWT_ISSUER,
            JWT_AUDIENCE: config.JWT_AUDIENCE,
          },
          enableApiKeys: true,
        }),
      ],
      controllers: [AuthController, ApiKeysController, UsersController, TenantsController],
      providers: [
        // Repositories (constructed from the global knex token).
        {
          provide: UserRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new UserRepository(knex),
        },
        {
          provide: TenantRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new TenantRepository(knex),
        },
        {
          provide: RoleRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new RoleRepository(knex),
        },
        {
          provide: ApiKeyRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new ApiKeyRepository(knex),
        },
        {
          provide: AuthRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new AuthRepository(knex),
        },
        {
          provide: AuditRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new AuditRepository(knex),
        },
        // Cache stores (RevocationStore is provided by the shared AuthModule and
        // injected by class into the use-cases below).
        {
          provide: SessionStore,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) => new SessionStore(redis),
        },
        {
          provide: RefreshStore,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) => new RefreshStore(redis),
        },
        {
          provide: RateLimiterStore,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) => new RateLimiterStore(redis),
        },
        // Services.
        {
          provide: PasswordHasher,
          useFactory: () =>
            new PasswordHasher({
              memoryKib: config.ARGON2_MEMORY_KIB,
              time: config.ARGON2_TIME,
              parallelism: config.ARGON2_PARALLELISM,
            }),
        },
        {
          provide: TokenService,
          inject: [JwtService],
          useFactory: (jwt: JwtService) =>
            new TokenService(jwt, {
              issuer: config.JWT_ISSUER,
              audience: config.JWT_AUDIENCE,
              accessTtlSeconds: accessTtl,
              refreshTtlSeconds: refreshTtl,
            }),
        },
        // Kafka outbox relay.
        {
          provide: KafkaOutboxRelay,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) =>
            new KafkaOutboxRelay(knex, {
              brokers: config.KAFKA_BROKERS.split(','),
              clientId: config.KAFKA_CLIENT_ID,
              auditTopic: config.KAFKA_AUDIT_TOPIC,
            }),
        },
        // Use-cases. RevocationStore resolves from the shared AuthModule.
        {
          provide: LoginUseCase,
          inject: [
            UserRepository,
            TenantRepository,
            AuthRepository,
            PasswordHasher,
            TokenService,
            SessionStore,
            RateLimiterStore,
            RoleRepository,
          ],
          useFactory: (
            u: UserRepository,
            t: TenantRepository,
            a: AuthRepository,
            h: PasswordHasher,
            tk: TokenService,
            s: SessionStore,
            r: RateLimiterStore,
            roles: RoleRepository,
          ) =>
            new LoginUseCase(u, t, a, h, tk, s, r, roles, {
              accessTtlSeconds: accessTtl,
              refreshTtlSeconds: refreshTtl,
              maxAttempts: config.LOGIN_MAX_ATTEMPTS,
              lockoutSeconds: config.LOGIN_LOCKOUT_SECONDS,
              rateLimitPerIp: 10,
              rateLimitPerUser: 5,
            }),
        },
        {
          provide: RefreshTokenUseCase,
          inject: [
            AuthRepository,
            UserRepository,
            TenantRepository,
            TokenService,
            RevocationStore,
            RoleRepository,
          ],
          useFactory: (
            a: AuthRepository,
            u: UserRepository,
            t: TenantRepository,
            tk: TokenService,
            revocation: RevocationStore,
            roles: RoleRepository,
          ) =>
            new RefreshTokenUseCase(a, u, t, tk, revocation, roles, {
              accessTtlSeconds: accessTtl,
            }),
        },
        {
          provide: LogoutUseCase,
          inject: [AuthRepository, SessionStore, RevocationStore],
          useFactory: (a: AuthRepository, s: SessionStore, revocation: RevocationStore) =>
            new LogoutUseCase(a, s, revocation),
        },
        {
          provide: CreateUserUseCase,
          inject: [UserRepository, PasswordHasher],
          useFactory: (u: UserRepository, h: PasswordHasher) =>
            new CreateUserUseCase(u, h, { minLength: config.PASSWORD_MIN_LENGTH }),
        },
        {
          provide: UpdateUserUseCase,
          inject: [UserRepository],
          useFactory: (u: UserRepository) => new UpdateUserUseCase(u),
        },
        {
          provide: AssignRoleUseCase,
          inject: [UserRepository, RevocationStore],
          useFactory: (u: UserRepository, revocation: RevocationStore) =>
            new AssignRoleUseCase(u, revocation, { accessTtlSeconds: accessTtl }),
        },
        {
          provide: CreateApiKeyUseCase,
          inject: [ApiKeyRepository, PasswordHasher],
          useFactory: (a: ApiKeyRepository, h: PasswordHasher) => new CreateApiKeyUseCase(a, h),
        },
        {
          provide: RevokeApiKeyUseCase,
          inject: [ApiKeyRepository],
          useFactory: (a: ApiKeyRepository) => new RevokeApiKeyUseCase(a),
        },
        {
          provide: ProvisionTenantUseCase,
          inject: [TenantRepository, RoleRepository, UserRepository, PasswordHasher],
          useFactory: (
            t: TenantRepository,
            r: RoleRepository,
            u: UserRepository,
            h: PasswordHasher,
          ) => new ProvisionTenantUseCase(t, r, u, h),
        },
        // Bootstrap seed.
        {
          provide: BootstrapSeed,
          inject: [ProvisionTenantUseCase, UserRepository, TenantRepository],
          useFactory: (p: ProvisionTenantUseCase, u: UserRepository, t: TenantRepository) =>
            new BootstrapSeed(p, u, t, config),
        },
      ],
    };
  }
}
