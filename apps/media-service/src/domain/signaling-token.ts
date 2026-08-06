/**
 * Signaling token — the per-stream opaque token binding a viewer to a session
 * (10 §5.4, INV-LV1).
 *
 * Opaque 256-bit (not a JWT); TTL 5 min sliding (renewed on heartbeat); stored
 * in Redis at `media:session:<sid>:token`. Binds {sessionId, channelId, tenantId,
 * userId, quality, expiresAt}. Verified by Socket.IO on connect AND by the SFU
 * before forwarding RTP. No media flows without a valid signaling token.
 */
import { randomBytes } from 'node:crypto';

export interface SignalingTokenPayload {
  readonly sessionId: string;
  readonly channelId: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly quality: string;
  readonly expiresAt: number; // epoch ms
}

export interface SignalingToken {
  /** The opaque token string (hex, 64 chars = 256 bits). */
  readonly token: string;
  readonly payload: SignalingTokenPayload;
}

/** Default TTL: 5 minutes (10 §5.4). */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Mint a new signaling token for a stream session. Pure (uses randomBytes for
 * the opaque value; the Redis storage is the caller's responsibility).
 */
export function mintSignalingToken(input: {
  sessionId: string;
  channelId: string;
  tenantId: string;
  userId: string | null;
  quality: string;
  ttlMs?: number;
  now?: Date;
}): SignalingToken {
  const now = (input.now ?? new Date()).getTime();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  return {
    token: randomBytes(32).toString('hex'),
    payload: {
      sessionId: input.sessionId,
      channelId: input.channelId,
      tenantId: input.tenantId,
      userId: input.userId,
      quality: input.quality,
      expiresAt: now + ttlMs,
    },
  };
}

/**
 * Verify a signaling token against the expected payload. Returns true iff the
 * token is not expired and the sessionId + tenantId match.
 */
export function verifySignalingToken(
  token: SignalingToken,
  expected: { sessionId: string; tenantId: string },
  now: Date = new Date(),
): boolean {
  if (token.payload.sessionId !== expected.sessionId) return false;
  if (token.payload.tenantId !== expected.tenantId) return false;
  return now.getTime() < token.payload.expiresAt;
}
