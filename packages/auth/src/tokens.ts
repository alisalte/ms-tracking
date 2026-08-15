/**
 * DI tokens for the auth package.
 */
export const AUTH_OPTIONS_TOKEN = 'FLEETVISION_AUTH_OPTIONS';

export interface AuthGuardOptions {
  readonly issuer: string;
  readonly audience: string;
}

// --- Sprint-D merge union: DI tokens for the composable JwtAuthGuard path
// (origin line). The identity-service constructs its own guard; these tokens
// let OTHER services wire `@UseGuards(JwtAuthGuard)` via jwtAuthGuardProvider().
export const TOKEN_VERIFIER = 'FLEETVISION_TOKEN_VERIFIER';
export const REVOCATION_CHECKER = 'FLEETVISION_REVOCATION_CHECKER';
export const PERMISSION_RESOLVER = 'FLEETVISION_PERMISSION_RESOLVER';
export const JWT_AUTH_GUARD = 'FLEETVISION_JWT_AUTH_GUARD';
