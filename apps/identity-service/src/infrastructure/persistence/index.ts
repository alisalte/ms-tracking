/**
 * Infrastructure/persistence layer for identity-service.
 *
 * Knex repositories for the identity aggregates (users, credentials,
 * auth_sessions, api_keys — see docs/specs/03_Database_Architecture.md §2.1 `iam` schema)
 * land here in later sprints. The PersistenceModule owns the client + migrations
 * runner; concrete repositories extend @fleetvision/persistence-knex
 * `BaseRepository` and own their SQL + mappers (ADR-021 §2.1: no ORM magic).
 *
 * Intentionally empty for Sprint 1 (Health + connectivity only).
 */
export {};
