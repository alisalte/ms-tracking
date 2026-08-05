/**
 * DI tokens for the gateway components (06 §1.5).
 *
 * Kept in a dedicated module (not gateway.module.ts) to avoid a circular import:
 * gateway.module.ts imports AdminController, and AdminController imports these
 * tokens. Putting the tokens here breaks the cycle so the decorator-evaluation
 * order (which reads the token constants at class-load time) resolves cleanly.
 */
export const ADAPTER_REGISTRY = 'GATEWAY_ADAPTER_REGISTRY';
export const SESSION_MANAGER = 'GATEWAY_SESSION_MANAGER';
export const PACKET_DISPATCHER = 'GATEWAY_PACKET_DISPATCHER';
export const CONNECTION_POOL = 'GATEWAY_CONNECTION_POOL';
export const KAFKA_PRODUCER = 'GATEWAY_KAFKA_PRODUCER';
export const DEVICE_REGISTRY = 'GATEWAY_DEVICE_REGISTRY';
export const INSTANCE_ID = 'GATEWAY_INSTANCE_ID';
export const GATEWAY_CONFIG = 'GATEWAY_CONFIG';
