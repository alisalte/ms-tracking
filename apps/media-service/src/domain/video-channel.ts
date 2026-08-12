/**
 * VideoChannel — the long-lived camera registration aggregate (09 §5.1).
 *
 * A registered camera: endpoint, codec, capabilities, ownership (site OR vehicle,
 * never both). One channel hosts zero-to-many concurrent StreamSessions.
 *
 * Lifecycle: REGISTERED → ONLINE → DEGRADED → OFFLINE → DECOMMISSIONED.
 */
import type { StreamType } from './media-frame.js';

export type ChannelStatus = 'REGISTERED' | 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'DECOMMISSIONED';

export type ChannelProtocol = 'JT1078' | 'RTSP' | 'RTMP' | 'WEBRTC';

export interface VideoChannelProps {
  readonly channelId: string;
  readonly tenantId: string;
  /** Vehicle (dashcam) or site (CCTV) — exactly one should be non-null. */
  readonly vehicleId: string | null;
  readonly siteId: string | null;
  readonly deviceId: string | null;
  readonly label: string;
  /** JT1078 logical channel (e.g. 1=forward). Null for RTSP/RTMP. */
  readonly logicalChannel: number | null;
  readonly protocol: ChannelProtocol;
  /** Camera's native codec. */
  readonly codec: StreamType;
  /** RTSP URL / RTMP stream key. Null for JT1078 (uses device SIM). */
  readonly endpoint: string | null;
  readonly status: ChannelStatus;
  readonly ptz: boolean;
  readonly capabilities: Record<string, unknown>;
  readonly version: number;
}

export class VideoChannel {
  public readonly channelId: string;
  public readonly tenantId: string;
  public readonly vehicleId: string | null;
  public readonly siteId: string | null;
  public readonly deviceId: string | null;
  public readonly label: string;
  public readonly logicalChannel: number | null;
  public readonly protocol: ChannelProtocol;
  public readonly codec: StreamType;
  public readonly endpoint: string | null;
  public readonly status: ChannelStatus;
  public readonly ptz: boolean;
  public readonly capabilities: Record<string, unknown>;
  public readonly version: number;

  constructor(props: VideoChannelProps) {
    this.channelId = props.channelId;
    this.tenantId = props.tenantId;
    this.vehicleId = props.vehicleId;
    this.siteId = props.siteId;
    this.deviceId = props.deviceId;
    this.label = props.label;
    this.logicalChannel = props.logicalChannel;
    this.protocol = props.protocol;
    this.codec = props.codec;
    this.endpoint = props.endpoint;
    this.status = props.status;
    this.ptz = props.ptz;
    this.capabilities = props.capabilities;
    this.version = props.version;
  }

  /** Is this channel available for streaming (not offline/decommissioned)? */
  public get isAvailable(): boolean {
    return this.status === 'ONLINE' || this.status === 'DEGRADED';
  }
}
