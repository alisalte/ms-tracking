/**
 * fleet-service config schema.
 *
 * Manages drivers + business trips. JWT verification uses the same HS256
 * secret as all services. Shares the same Postgres database (fleet schema).
 */
import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

export const fleetConfigSchema = baseConfigSchema.merge(
  z.object({
    DBURL: z.string().min(1),
    DBURL_PLATFORM: z.string().min(1).optional(),
    REDISURL: z.string().min(1),

    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default('fleetvision'),
    JWT_AUDIENCE: z.string().min(1).default('fleetvision-identity'),
  }),
);

export type FleetConfig = z.infer<typeof fleetConfigSchema>;
