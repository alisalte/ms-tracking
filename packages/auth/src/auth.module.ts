/**
 * AuthCoreModule — the minimum wiring every service needs to authenticate
 * identity-issued JWTs: `JwtModule` (HS256, shared secret/issuer/audience) and a
 * `SharedJwtVerifier` bound to the `TokenVerifier` port. Services that also need
 * RBAC additionally provide a `PermissionResolver` and a `JwtAuthGuard` instance
 * in their own module.
 *
 * The identity-service does NOT use this module — it keeps its own `TokenService`
 * (which also issues tokens). This module is the read-only peer for the four
 * non-identity services.
 */
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { SharedJwtVerifier, type SharedJwtVerifierConfig } from './shared-jwt-verifier.js';
import { TOKEN_VERIFIER } from './tokens.js';

export interface AuthCoreModuleOptions extends SharedJwtVerifierConfig {
  readonly jwtSecret: string;
}

@Global()
@Module({})
export class AuthCoreModule {
  public static forRoot(options: AuthCoreModuleOptions): DynamicModule {
    const verifierProvider = {
      provide: SharedJwtVerifier,
      inject: [JwtService],
      useFactory: (jwt: JwtService) => new SharedJwtVerifier(jwt, options),
    };
    const tokenVerifierProvider = {
      provide: TOKEN_VERIFIER,
      useExisting: SharedJwtVerifier,
    };
    return {
      module: AuthCoreModule,
      global: true,
      imports: [
        JwtModule.register({
          secret: options.jwtSecret,
          signOptions: {
            algorithm: 'HS256',
            issuer: options.issuer,
            audience: options.audience,
          },
        }),
      ],
      providers: [verifierProvider, tokenVerifierProvider],
      exports: [TOKEN_VERIFIER, JwtModule],
    };
  }
}
