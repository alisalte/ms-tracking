/**
 * Map-engine request body schemas (Zod). Replaces the raw `Record<string,
 * unknown>` bodies on the create-POI / create-geofence / route-match endpoints
 * with validated, coerced payloads — consistent with the identity-service DTO
 * convention. tenant_id is intentionally absent (INV-I02: derived from the JWT).
 */
import { z } from 'zod';

export const createPoiSchema = z.object({
  name: z.string().min(1).max(128),
  category: z.string().min(1).max(64).default('UNKNOWN'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusM: z.coerce.number().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreatePoiDto = z.infer<typeof createPoiSchema>;

export const createGeofenceSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(['POLYGON', 'CIRCLE', 'CORRIDOR']).default('POLYGON'),
  boundary: z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.array(z.coerce.number()))),
  }),
  centerLat: z.coerce.number().optional(),
  centerLng: z.coerce.number().optional(),
  radiusM: z.coerce.number().min(0).optional(),
  alertOn: z.array(z.string()).optional(),
  dwellSec: z.coerce.number().int().min(0).optional(),
});
export type CreateGeofenceDto = z.infer<typeof createGeofenceSchema>;

export const routeMatchSchema = z.object({
  points: z
    .array(
      z.object({
        lat: z.coerce.number(),
        lng: z.coerce.number(),
      }),
    )
    .min(1),
  quality: z.string().optional(),
});
export type RouteMatchDto = z.infer<typeof routeMatchSchema>;
