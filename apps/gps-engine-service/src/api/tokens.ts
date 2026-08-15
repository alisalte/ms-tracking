/**
 * DI tokens for gps-engine-service (mirrors the gateway's tokens.ts pattern).
 * String tokens live in a separate file to break circular imports between the
 * module and the providers it wires.
 */
export const GPS_ENGINE_CONFIG = 'GPS_ENGINE_CONFIG';
export const POSITION_REPOSITORY = 'POSITION_REPOSITORY';
export const DEVICE_STATUS_REPOSITORY = 'DEVICE_STATUS_REPOSITORY';
export const TRIP_REPOSITORY = 'TRIP_REPOSITORY';
export const POSITION_CACHE = 'POSITION_CACHE';
export const DEVICE_STATUS_CACHE = 'DEVICE_STATUS_CACHE';
export const FSM_CACHE = 'FSM_CACHE';
export const SIGNAL_BUS = 'SIGNAL_BUS';
export const POSITION_PIPELINE = 'POSITION_PIPELINE';
export const DEVICE_STATUS_PIPELINE = 'DEVICE_STATUS_PIPELINE';
export const TRIP_ENGINE = 'TRIP_ENGINE';
export const KAFKA_CONSUMER = 'KAFKA_CONSUMER';
export const DLQ_PRODUCER = 'DLQ_PRODUCER';
export const TRACKING_EVENT_PRODUCER = 'TRACKING_EVENT_PRODUCER';
export const STALE_SWEEPER = 'STALE_SWEEPER';
export const REALTIME_GATEWAY = 'REALTIME_GATEWAY';
