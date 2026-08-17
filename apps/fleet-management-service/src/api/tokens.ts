/**
 * DI tokens for fleet-management-service (string tokens in a separate file to
 * break circular imports between the module and the providers it wires — mirrors
 * the gps-engine / device-gateway pattern).
 */
export const FLEET_MANAGEMENT_CONFIG = 'FLEET_MANAGEMENT_CONFIG';
export const FLEET_SERVICE = 'FLEET_SERVICE';
export const VEHICLE_SERVICE = 'VEHICLE_SERVICE';
export const DEVICE_SERVICE = 'DEVICE_SERVICE';
export const BINDING_SERVICE = 'BINDING_SERVICE';
export const SUMMARY_SERVICE = 'SUMMARY_SERVICE';
export const DEVICE_COMMAND_SERVICE = 'DEVICE_COMMAND_SERVICE';
export const DEVICE_REPOSITORY = 'DEVICE_REPOSITORY';
export const DEVICE_COMMAND_REPOSITORY = 'DEVICE_COMMAND_REPOSITORY';
export const SESSION_LIFECYCLE_CONSUMER = 'SESSION_LIFECYCLE_CONSUMER';
export const COMMAND_REQUEST_PRODUCER = 'COMMAND_REQUEST_PRODUCER';
export const COMMAND_ACK_CONSUMER = 'COMMAND_ACK_CONSUMER';
