/**
 * @fleetvision/shared-kernel — public surface.
 *
 * The Shared Kernel is the small, governed set of code every service depends on.
 * Adding to it requires ARB review (Codebase Architecture §9 governance rule):
 * only concepts that are genuinely shared (2+ contexts) AND stable (part of the
 * ubiquitous language) belong here.
 */
export * from './domain/AggregateRoot.js';
export * from './domain/DomainEvent.js';
export * from './domain/Entity.js';
export * from './domain/Identifier.js';
export * from './domain/Result.js';
export * from './domain/ValueObject.js';

export * from './value-objects/Money.js';
export * from './value-objects/GeoPoint.js';

export * from './errors/DomainError.js';
export * from './errors/codes.js';

export * from './types/pagination.js';

export * from './tenancy/TenantId.js';
export * from './tenancy/TenantContext.js';
