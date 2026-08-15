/**
 * DI tokens for the auth package.
 */
export const AUTH_OPTIONS_TOKEN = 'FLEETVISION_AUTH_OPTIONS';

export interface AuthGuardOptions {
  readonly issuer: string;
  readonly audience: string;
}
