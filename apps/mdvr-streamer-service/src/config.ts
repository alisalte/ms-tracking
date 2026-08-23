/**
 * mdvr-streamer config (env-validated at boot; invalid config crashes fast).
 */
import { z } from 'zod';

export const streamerConfigSchema = z.object({
  /** HTTP + WebSocket port (nginx-fronted; browsers connect here). */
  PORT: z.coerce.number().int().min(1).max(65535).default(3013),
  /** Bind address for the HTTP/WS server. */
  HOST: z.string().min(1).default('0.0.0.0'),
  /** TCP port the DEVICE dials back on with binary 0x12 media packets. */
  VIDEO_PORT: z.coerce.number().int().min(1).max(65535).default(6182),
  /** Bind address for the device video listener. */
  VIDEO_HOST: z.string().min(1).default('0.0.0.0'),
  /** ffmpeg binary (override for tests / non-standard installs). */
  FFMPEG_BIN: z.string().min(1).default('ffmpeg'),
  /** Max concurrent device video sessions; excess connections are refused. */
  MAX_STREAMS: z.coerce.number().int().min(1).default(32),
  /** Log verbosity: 'debug' | 'info' | 'warn' | 'error'. */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type StreamerConfig = z.infer<typeof streamerConfigSchema>;
