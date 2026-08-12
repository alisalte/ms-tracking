/** Fleet-service request body schemas (Zod). tenant_id is from JWT (INV-I02). */
import { z } from 'zod';

export const createDriverSchema = z.object({
  employee_id: z.string().max(64).nullable().optional(),
  first_name: z.string().min(1).max(128),
  last_name: z.string().min(1).max(128),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  license_number: z.string().min(1).max(64),
  license_class: z.string().max(32).nullable().optional(),
  license_issued: z.string().datetime().nullable().optional(),
  license_expires: z.string().datetime().nullable().optional(),
  license_country: z.string().max(64).nullable().optional(),
});
export type CreateDriverDto = z.infer<typeof createDriverSchema>;

export const updateDriverSchema = z.object({
  employee_id: z.string().max(64).nullable().optional(),
  first_name: z.string().min(1).max(128).optional(),
  last_name: z.string().min(1).max(128).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  license_number: z.string().min(1).max(64).optional(),
  license_class: z.string().max(32).nullable().optional(),
  license_issued: z.string().datetime().nullable().optional(),
  license_expires: z.string().datetime().nullable().optional(),
  license_country: z.string().max(64).nullable().optional(),
});
export type UpdateDriverDto = z.infer<typeof updateDriverSchema>;

export const assignVehicleSchema = z.object({
  vehicle_id: z.string().uuid(),
});
export type AssignVehicleDto = z.infer<typeof assignVehicleSchema>;

export const createTripSchema = z.object({
  driver_id: z.string().uuid().nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  origin_label: z.string().max(256).nullable().optional(),
  origin_lat: z.coerce.number().nullable().optional(),
  origin_lng: z.coerce.number().nullable().optional(),
  destination_label: z.string().max(256).nullable().optional(),
  destination_lat: z.coerce.number().nullable().optional(),
  destination_lng: z.coerce.number().nullable().optional(),
  purpose: z.string().max(256).nullable().optional(),
  notes: z.string().nullable().optional(),
  planned_start: z.string().datetime().nullable().optional(),
  planned_end: z.string().datetime().nullable().optional(),
});
export type CreateTripDto = z.infer<typeof createTripSchema>;

export const updateTripSchema = z.object({
  driver_id: z.string().uuid().nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  origin_label: z.string().max(256).nullable().optional(),
  destination_label: z.string().max(256).nullable().optional(),
  purpose: z.string().max(256).nullable().optional(),
  notes: z.string().nullable().optional(),
  planned_start: z.string().datetime().nullable().optional(),
  planned_end: z.string().datetime().nullable().optional(),
});
export type UpdateTripDto = z.infer<typeof updateTripSchema>;

export const completeTripSchema = z.object({
  distance_km: z.coerce.number().min(0).optional(),
  duration_sec: z.number().int().min(0).optional(),
});
export type CompleteTripDto = z.infer<typeof completeTripSchema>;
