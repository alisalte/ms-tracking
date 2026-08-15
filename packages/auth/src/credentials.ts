/**
 * Credential extraction helpers — pull the presented credential (JWT or API key)
 * off an HTTP request in a single place so every guard agrees on precedence.
 *
 *   Authorization: Bearer <jwt>          → JWT
 *   Authorization: Bearer fv_<env>_<sec> → API key
 *   X-API-Key: fv_<env>_<sec>            → API key
 */
import type { Request } from 'express';

export type CredentialKind = 'JWT' | 'API_KEY' | 'NONE';

export interface ExtractedCredential {
  readonly kind: CredentialKind;
  readonly value: string;
}

const API_KEY_PREFIX = 'fv_';

export function extractCredential(req: Request): ExtractedCredential {
  const headerApiKey = req.headers['x-api-key'];
  if (typeof headerApiKey === 'string' && headerApiKey.length > 0) {
    return { kind: 'API_KEY', value: headerApiKey.trim() };
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const value = auth.slice('Bearer '.length).trim();
    if (value.length === 0) return { kind: 'NONE', value: '' };
    // An API key is always `fv_...`; anything else is treated as a JWT.
    const kind: CredentialKind = value.startsWith(API_KEY_PREFIX) ? 'API_KEY' : 'JWT';
    return { kind, value };
  }
  return { kind: 'NONE', value: '' };
}
