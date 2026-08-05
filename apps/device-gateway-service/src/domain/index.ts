/**
 * Device Gateway domain layer — public surface.
 *
 * The gateway participates in the Telematics bounded context (02 §1, Context 6)
 * but owns only ingestion-tier, transient aggregates (06 §11): the session
 * sub-domain. Durable Telematics aggregates (TelematicsDevice, FirmwarePackage,
 * DeviceCommand) are owned by device-management-service; the gateway reads them
 * via gRPC (the DeviceRegistry port) and emits raw events *about* them.
 */
export { DeviceMessage, type Position, type Alarm, type MessageType } from './device-message.js';
export {
  RawPacket,
  type RawPacketProps,
  type Direction,
} from './raw-packet.js';
export {
  DeviceSession,
  type DeviceSessionProps,
  type DeviceSessionSnapshot,
  type SessionState,
  type Transport,
  type CloseReason,
} from './device-session.js';
export {
  type SessionId,
  asSessionId,
  newSessionId,
} from './session-id.js';
export {
  HeartbeatPolicy,
  type HeartbeatPolicyOptions,
  DEFAULT_HEARTBEAT_POLICY,
  type TimeoutDecision,
  type TimeoutReason,
} from './heartbeat.js';
export {
  IllegalSessionTransitionError,
  SessionInvariantError,
  ProtocolError,
  AuthError,
} from './errors.js';
