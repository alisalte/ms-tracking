/**
 * IAM domain layer — public surface for the application layer. Aggregates,
 * value objects, domain events, the permission catalog, and domain errors.
 * (Codebase Architecture §5: the Domain layer depends on nothing
 * framework-specific.)
 */
export * from './shared/ids.js';
export * from './permissions.js';
export * from './errors.js';
export * from './password-policy.js';
export * from './events.js';
export * from './user.js';
export * from './tenant.js';
export * from './tenant-settings.js';
export * from './role.js';
export * from './api-key.js';
export * from './refresh-token-family.js';
