/**
 * Protocol Abstraction Layer — public surface (06 §9).
 */
export type {
  ProtocolAdapter,
  ProtocolMeta,
  DetectionResult,
  DeviceCommand,
} from './protocol-adapter.js';
export {
  AdapterRegistry,
  DETECTION_THRESHOLD,
  type RegistryEntry,
  type AdapterStats,
} from './adapter-registry.js';
export { PluginLoader, type PluginLoaderOptions } from './plugin-loader.js';
