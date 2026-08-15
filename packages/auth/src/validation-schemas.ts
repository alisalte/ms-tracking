/**
 * Shared Zod validation schemas for request params/query. The pure-TS
 * pagination constants/types live in @fleetvision/shared-kernel (no framework
 * deps); these Zod schemas live here because @fleetvision/auth already depends
 * on zod and is imported by every service.
 *
 * Usage:
 *   @Param(new ZodValidationPipe(uuidParamSchema)) params: { id: string }
 *   @Query(new ZodValidationPipe(pageRequestSchema)) page: PageRequestDto
 */
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PageRequest } from '@fleetvision/shared-kernel';
import { z } from 'zod';

/** Validates a `:id` path param is a canonical UUID. */
export const uuidParamSchema = z.object({
  id: z.string().uuid(),
});
export type UuidParamDto = z.infer<typeof uuidParamSchema>;

/**
 * Validates a client page request: optional `limit` (1..MAX_PAGE_SIZE, defaulting
 * to DEFAULT_PAGE_SIZE) + optional opaque `cursor` string. Coerces string query
 * params to numbers. Rejects non-integer/negative limits.
 */
export const pageRequestSchema = z.object({
  limit: z.coerce
    .number()
    .int('limit must be an integer')
    .min(1, 'limit must be >= 1')
    .max(MAX_PAGE_SIZE, `limit must be <= ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).optional(),
});
export type PageRequestDto = z.infer<typeof pageRequestSchema> & PageRequest;

/** Validates a datetime query string (ISO-8601); returns a Date. */
export const datetimeQuerySchema = z
  .string()
  .min(1)
  .transform((s) => new Date(s))
  .refine((d) => Number.isFinite(d.getTime()), 'Invalid datetime');
