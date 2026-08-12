/**
 * Media-service request body schemas (Zod). Replaces the raw `Record<string,
 * unknown>` bodies on the open-stream / register-channel endpoints with
 * validated, coerced payloads. tenant_id is absent (INV-I02: from the JWT).
 */
import { z } from 'zod';

export const openStreamSchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  quality: z.string().optional(),
  mode: z.string().optional(),
});
export type OpenStreamDto = z.infer<typeof openStreamSchema>;

export const openBatchSchema = z.object({
  channelIds: z.array(z.string().uuid()).min(1),
  quality: z.string().optional(),
});
export type OpenBatchDto = z.infer<typeof openBatchSchema>;

export const registerChannelSchema = z.object({
  vehicleId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  deviceId: z.string().uuid().nullable().optional(),
  label: z.string().min(1).max(128),
  logicalChannel: z.coerce.number().int().nullable().optional(),
  protocol: z.string().default('RTSP'),
  codec: z.string().default('H264'),
  endpoint: z.string().nullable().optional(),
  ptz: z.coerce.boolean().optional(),
});
export type RegisterChannelDto = z.infer<typeof registerChannelSchema>;
