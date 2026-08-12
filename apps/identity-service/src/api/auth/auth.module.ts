import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { KNEX_TOKEN, PLATFORM_KNEX_TOKEN } from '@fleetvision/persistence-knex';
import type { Knex } from '@fleetvision/persistence-knex';
import { Module } from '@nestjs/common';
/**
 * AuthModule — wires the auth feature: repositories, cache stores, services,
 * use-cases, and the auth/api-keys controllers. Config (TTLs, secrets, argon2
 * params) is read from the validated IdentityConfig via the IDENTITY_CONFIG
 * token registered in AppModule.
 */
import { JwtModule, JwtService } from '@nestjs/jwt';
import {
  AssignRoleUseCase,
  AuditManager,
  CreateApiKeyUseCase,
  CreateUserUseCase,
  LoginUseCase,
  LogoutUseCase,
  ProvisionTenantUseCase,
  RefreshTokenUseCase,
  RevokeApiKeyUseCase,
  TenantLifecycleUseCase,
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
  RevocationStore,
  RoleRepository,
  SessionStore,
  TenantRepository,
  TokenService,
  UserRepository,
} from '../../infrastructure/index.js';
import { KafkaOutboxRelay } from '../../infrastructure/index.js';
import { UsersController } from '../iam/users.controller.js';
import { BootstrapSeed } from '../shared/bootstrap-seed.js';
import { JwtAuthGuard } from '../shared/jwt-auth.guard.js';
import { PermissionsGuard } from '../shared/permissions.guard.js';
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
        JwtModule.register({
          secret: config.JWT_SECRET,
          signOptions: {
            algorithm: 'HS256',
            issuer: config.JWT_ISSUER,
            audience: config.JWT_AUDIENCE,
          },
        }),
      ],
      controllers: [AuthController, ApiKeysController, UsersController, TenantsController],
      providers: [
        // Repositories (constructed from the global knex/redis tokens).
        {
          provide: UserRepository,
          inject: [KNEX_TOKEN, PLATFORM_KNEX_TOKEN],
          useFactory: (knex: Knex, platformKnex: Knex) => new UserRepository(knex, platformKnex),
        },
        {
          provide: TenantRepository,
          // Platform client only — tenants is the documented RLS exception.
          inject: [PLATFORM_KNEX_TOKEN],
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
          inject: [KNEX_TOKEN, PLATFORM_KNEX_TOKEN],
          useFactory: (knex: Knex, platformKnex: Knex) => new AuthRepository(knex, platformKnex),
        },
        {
          provide: AuditRepository,
          inject: [PLATFORM_KNEX_TOKEN],
          useFactory: (knex: Knex) => new AuditRepository(knex),
        },
        {
          provide: AuditManager,
          inject: [PLATFORM_KNEX_TOKEN, AuditRepository],
          useFactory: (knex: Knex, audit: AuditRepository) => new AuditManager(knex, audit),
        },
        // Cache stores.
        {
          provide: SessionStore,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) => new SessionStore(redis),
        },
        {
          provide: RevocationStore,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) => new RevocationStore(redis),
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
        // Guards.
        JwtAuthGuard,
        PermissionsGuard,
        // Use-cases.
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
            AuditManager,
          ],
          useFactory: (
            u: UserRepository,
            t: TenantRepository,
            a: AuthRepository,
            h: PasswordHasher,
            tk: TokenService,
            s: SessionStore,
            r: RateLimiterStore,
            audit: AuditManager,
          ) =>
            new LoginUseCase(
              u,
              t,
              a,
              h,
              tk,
              s,
              r,
              {
                accessTtlSeconds: accessTtl,
                refreshTtlSeconds: refreshTtl,
                maxAttempts: config.LOGIN_MAX_ATTEMPTS,
                lockoutSeconds: config.LOGIN_LOCKOUT_SECONDS,
                rateLimitPerIp: 10,
                rateLimitPerUser: 5,
              },
              audit,
            ),
        },
        {
          provide: RefreshTokenUseCase,
          inject: [AuthRepository, UserRepository, TenantRepository, TokenService, RevocationStore],
          useFactory: (
            a: AuthRepository,
            u: UserRepository,
            t: TenantRepository,
            tk: TokenService,
            rv: RevocationStore,
          ) => new RefreshTokenUseCase(a, u, t, tk, rv, { accessTtlSeconds: accessTtl }),
        },
        {
          provide: LogoutUseCase,
          inject: [AuthRepository, SessionStore, RevocationStore, AuditManager],
          useFactory: (
            a: AuthRepository,
            s: SessionStore,
            rv: RevocationStore,
            audit: AuditManager,
          ) => new LogoutUseCase(a, s, rv, audit),
        },
        {
          provide: CreateUserUseCase,
          inject: [UserRepository, PasswordHasher, AuditManager],
          useFactory: (u: UserRepository, h: PasswordHasher, audit: AuditManager) =>
            new CreateUserUseCase(u, h, { minLength: config.PASSWORD_MIN_LENGTH }, audit),
        },
        {
          provide: UpdateUserUseCase,
          inject: [UserRepository, AuditManager],
          useFactory: (u: UserRepository, audit: AuditManager) => new UpdateUserUseCase(u, audit),
        },
        {
          provide: AssignRoleUseCase,
          inject: [UserRepository, AuditManager],
          useFactory: (u: UserRepository, audit: AuditManager) => new AssignRoleUseCase(u, audit),
        },
        {
          provide: CreateApiKeyUseCase,
          inject: [ApiKeyRepository, PasswordHasher, AuditManager],
          useFactory: (a: ApiKeyRepository, h: PasswordHasher, audit: AuditManager) =>
            new CreateApiKeyUseCase(a, h, audit),
        },
        {
          provide: RevokeApiKeyUseCase,
          inject: [ApiKeyRepository, AuditManager],
          useFactory: (a: ApiKeyRepository, audit: AuditManager) =>
            new RevokeApiKeyUseCase(a, audit),
        },
        {
          provide: ProvisionTenantUseCase,
          inject: [TenantRepository, RoleRepository, UserRepository, PasswordHasher, AuditManager],
          useFactory: (
            t: TenantRepository,
            r: RoleRepository,
            u: UserRepository,
            h: PasswordHasher,
            audit: AuditManager,
          ) => new ProvisionTenantUseCase(t, r, u, h, audit),
        },
        {
          provide: TenantLifecycleUseCase,
          inject: [TenantRepository, AuditManager],
          useFactory: (t: TenantRepository, audit: AuditManager) =>
            new TenantLifecycleUseCase(t, audit),
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
