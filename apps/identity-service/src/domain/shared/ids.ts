/**
 * Branded id types for the IAM domain. Each is a nominal string so a UserId
 * can't be passed where a TenantId is expected (docs/specs/02_Domain_Model.md
 * §8 / Codebase Architecture §9). Construction happens at trust boundaries
 * (DB rehydration, verified JWT claims) via `asId`.
 */
import type { Brand } from '@fleetvision/shared-kernel';

export type UserId = Brand<string, 'UserId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type OrgId = Brand<string, 'OrgId'>;
export type ApiKeyId = Brand<string, 'ApiKeyId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type RefreshFamilyId = Brand<string, 'RefreshFamilyId'>;
