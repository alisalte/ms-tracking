/**
 * Application layer — protocol-agnostic orchestration (06 §5–§8).
 */
export {
  ConnectionPool,
  type ConnectionPoolOptions,
  type PoolPressure,
  type EvictionCandidate,
} from './connection-pool.js';
export {
  AuthResolver,
  type AuthResolverOptions,
  type AuthOutcome,
} from './auth-resolver.js';
export {
  SessionManager,
  type SessionManagerOptions,
  type SessionLifecycleEmitter,
  type RegisterResult,
} from './session-manager.js';
export {
  PacketDispatcher,
  type PacketDispatcherDeps,
  type DispatchResult,
} from './packet-dispatcher.js';
export {
  CommandDispatcher,
  type DeviceCommandRequest,
  type CommandDispatchResult,
} from './command-dispatcher.js';
