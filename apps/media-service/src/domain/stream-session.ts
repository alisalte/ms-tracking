/**
 * StreamSession — the short-lived per-consumer session aggregate (09 §5.2).
 *
 * One consumer's (viewer / recording / AI) use of a channel. A single ONLINE
 * channel can host zero-to-many concurrent StreamSessions.
 *
 * Lifecycle: CONNECTING → ACTIVE → DEGRADED → CLOSED.
 */

export type StreamMode = 'LIVE' | 'PLAYBACK' | 'RECORD' | 'AI';

export type SessionState = 'CONNECTING' | 'ACTIVE' | 'DEGRADED' | 'CLOSED';

export type Quality = 'auto' | 'high' | 'medium' | 'low' | 'audio-only';

export interface StreamSessionProps {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly channelId: string;
  readonly userId: string | null;
  readonly mode: StreamMode;
  readonly quality: Quality;
  readonly state: SessionState;
  readonly streamerPod: string | null;
  readonly viewerCount: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export class StreamSession {
  public readonly sessionId: string;
  public readonly tenantId: string;
  public readonly channelId: string;
  public readonly userId: string | null;
  public readonly mode: StreamMode;
  public readonly quality: Quality;
  public readonly state: SessionState;
  public readonly streamerPod: string | null;
  public readonly viewerCount: number;
  public readonly startedAt: Date;
  public readonly endedAt: Date | null;

  constructor(props: StreamSessionProps) {
    this.sessionId = props.sessionId;
    this.tenantId = props.tenantId;
    this.channelId = props.channelId;
    this.userId = props.userId;
    this.mode = props.mode;
    this.quality = props.quality;
    this.state = props.state;
    this.streamerPod = props.streamerPod;
    this.viewerCount = props.viewerCount;
    this.startedAt = props.startedAt;
    this.endedAt = props.endedAt;
  }

  /** Is this session still consuming media? */
  public get isActive(): boolean {
    return this.state !== 'CLOSED';
  }
}
