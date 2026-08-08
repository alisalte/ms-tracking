import type { TokenPair } from '@/types/auth.types';

const TOKENS_KEY = 'fleetvision_tokens';
const TENANT_KEY = 'fleetvision_tenant_id';

/**
 * Persist the token pair + tenant ID to localStorage.
 */
export function saveTokens(tokens: TokenPair): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  localStorage.setItem(TENANT_KEY, tokens.tenantId);
}

/**
 * Retrieve the stored token pair.
 * Returns null if not found or corrupted.
 */
export function getStoredTokens(): TokenPair | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TokenPair;
  } catch {
    return null;
  }
}

/**
 * Get just the access token (if available).
 */
export function getAccessToken(): string | null {
  const tokens = getStoredTokens();
  return tokens?.accessToken ?? null;
}

/**
 * Get just the refresh token (if available).
 */
export function getRefreshToken(): string | null {
  const tokens = getStoredTokens();
  return tokens?.refreshToken ?? null;
}

/**
 * Get the stored tenant ID.
 */
export function getTenantId(): string | null {
  return localStorage.getItem(TENANT_KEY);
}

/**
 * Store tenant ID independently (used before login when no tokens exist).
 */
export function saveTenantId(tenantId: string): void {
  localStorage.setItem(TENANT_KEY, tenantId);
}

/**
 * Clear all auth-related storage (logout).
 */
export function clearTokens(): void {
  localStorage.removeItem(TOKENS_KEY);
  localStorage.removeItem(TENANT_KEY);
}
