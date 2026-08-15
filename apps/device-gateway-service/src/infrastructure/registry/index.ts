/**
 * Device registry — public surface (06 §7, §11).
 *
 * Two `DeviceRegistry` implementations share the port (06 §7.2 L3):
 *   - `InMemoryDeviceRegistry` — tests + local dev (seeded from config).
 *   - `HttpDeviceRegistry` — production (calls fleet-management-service). Sprint C.
 */
export {
  type DeviceRegistry,
  type ResolvedDevice,
  type DeviceStatus,
  type Resolution,
  type TenantStatus,
  InMemoryDeviceRegistry,
} from './device-registry.port.js';
export { HttpDeviceRegistry, type HttpDeviceRegistryOptions } from './http-device-registry.js';
export {
  RegistryInvalidationSubscriber,
  REGISTRY_INVALIDATION_CHANNEL,
  type RegistryInvalidationMessage,
} from './registry-invalidation-subscriber.js';
