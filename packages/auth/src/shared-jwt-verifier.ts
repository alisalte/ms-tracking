/**
 * SharedJwtVerifier — verifies access tokens issued by the identity-service using
 * the SAME HS256 secret + issuer + audience. This lets the four non-identity
 * services trust identity-issued JWTs without a second auth mechanism.
 *
 * The identity-service itself does NOT use this class — it has its own
 * `TokenService` that additionally issues tokens and hashes refresh tokens. This
 * verifier is the read-only peer that other services inject as their
 * `TokenVerifier`.
 */
import { Injectable } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { TokenVerifier, VerifiedToken } from './token-verifier.port.js';

export interface SharedJwtVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
}

@Injectable()
export class SharedJwtVerifier implements TokenVerifier {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: SharedJwtVerifierConfig,
  ) {}

  public async verifyAccess(token: string): Promise<VerifiedToken> {
    const payload = await this.jwt.verifyAsync(token, {
      algorithms: ['HS256'],
      issuer: this.config.issuer,
      audience: this.config.audience,
    });
    return payload as VerifiedToken;
  }
}
