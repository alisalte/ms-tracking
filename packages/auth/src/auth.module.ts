/**
 * AuthModule — the turnkey authentication/authorization wiring. A service
 * imports `AuthModule.forRoot({ jwt })` and gets: JWT + API-key verification,
 * revocation checks (shared Redis), the global CompositeAuthGuard +
 * PermissionsGuard (APP_GUARD), and the AuthenticatedContext on every
 * authenticated request. No service implements its own auth.
 *
 * `@Public()` exempts a route (health, login, refresh). `@RequirePermissions()`
 * gates a route. Device TCP/UDP protocol listeners are NOT Nest HTTP routes and
 * are therefore unaffected — only HTTP control/admin APIs are guarded.
 */
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import type { Knex } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ApiKeyVerifier, KnexApiKeyVerifier } from './api-key-verifier.js';
import { CompositeAuthGuard } from './composite-auth.guard.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RevocationStore } from './revocation-store.js';
import { AUTH_OPTIONS_TOKEN } from './tokens.js';

export interface AuthModuleOptions {
  /** JWT verification config (secret + issuer + audience). */
  readonly jwt: {
    readonly JWT_SECRET: string;
    readonly JWT_ISSUER: string;
    readonly JWT_AUDIENCE: string;
  };
  /**
   * Enable API-key authentication (queries the shared `iam.api_keys` table).
   * Default `true`. Disable for services that should accept JWTs only.
   */
  readonly enableApiKeys?: boolean;
}

@Module({})
export class AuthModule {
  public static forRoot(options: AuthModuleOptions): DynamicModule {
    const enableApiKeys = options.enableApiKeys ?? true;

    const providers: NonNullable<DynamicModule['providers']> = [
      {
        provide: AUTH_OPTIONS_TOKEN,
        useValue: {
          issuer: options.jwt.JWT_ISSUER,
          audience: options.jwt.JWT_AUDIENCE,
        },
      },
      {
        provide: RevocationStore,
        inject: [REDIS_TOKEN],
        useFactory: (redis: Redis) => new RevocationStore(redis),
      },
      ...(enableApiKeys
        ? [
            {
              provide: ApiKeyVerifier,
              inject: [KNEX_TOKEN],
              useFactory: (knex: Knex) => new KnexApiKeyVerifier(knex),
            },
          ]
        : []),
      // Guards are constructed by Nest DI (JwtService, Reflector, AUTH_OPTIONS,
      // and the optional RevocationStore / ApiKeyVerifier resolve automatically).
      CompositeAuthGuard,
      PermissionsGuard,
      // Global guard registration — authentication first, authorization second.
      { provide: APP_GUARD, useExisting: CompositeAuthGuard },
      { provide: APP_GUARD, useExisting: PermissionsGuard },
    ];

    return {
      module: AuthModule,
      imports: [
        JwtModule.register({
          secret: options.jwt.JWT_SECRET,
          verifyOptions: {
            algorithms: ['HS256'],
            issuer: options.jwt.JWT_ISSUER,
            audience: options.jwt.JWT_AUDIENCE,
          },
        }),
      ],
      providers,
      // JwtModule is re-exported so importing services that also SIGN tokens
      // (identity-service's TokenService) can inject JwtService.
      exports: [JwtModule, RevocationStore, CompositeAuthGuard, PermissionsGuard],
    };
  }
}
