/**
 * DI tokens for @fleetvision/auth. String tokens avoid circular imports between
 * the module and the providers/ports it wires (mirrors the per-service tokens.ts
 * pattern used across FleetVision).
 */
export const TOKEN_VERIFIER = 'FLEETVISION_TOKEN_VERIFIER';
export const REVOCATION_CHECKER = 'FLEETVISION_REVOCATION_CHECKER';
export const PERMISSION_RESOLVER = 'FLEETVISION_PERMISSION_RESOLVER';
export const JWT_AUTH_GUARD = 'FLEETVISION_JWT_AUTH_GUARD';
