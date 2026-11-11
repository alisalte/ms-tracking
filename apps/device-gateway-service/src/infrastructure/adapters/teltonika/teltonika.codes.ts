/**
 * Teltonika AVL IO catalog and alarm mapping (FMB640 / FMB-family AVL IDs).
 *
 * Every IO element a record carries is kept verbatim in `DeviceMessage.io`
 * keyed by its AVL id. The elements listed here are additionally promoted to
 * named `telemetry` fields the rest of the platform already understands
 * (`powerVoltage`, `batteryVoltage`, `odometerKm`, `hdop`, `ignitionOn`, …).
 *
 * The CAN block (81–89, 115) only reports when a CAN adapter is wired and
 * configured on the FMB640. Anything not listed still arrives under `io`.
 */
import type { Alarm } from '../../../domain/device-message.js';

export interface IoDescriptor {
  /** Telemetry field name. */
  readonly name: string;
  /** Multiplier applied to the raw value (e.g. 0.001 for mV → V). */
  readonly scale?: number;
  /** Raw value is a signed integer (two's complement at its wire width). */
  readonly signed?: boolean;
  /** Render as boolean (non-zero → true). */
  readonly bool?: boolean;
}

export const IO_CATALOG: Readonly<Record<number, IoDescriptor>> = {
  1: { name: 'digitalInput1', bool: true },
  2: { name: 'digitalInput2', bool: true },
  3: { name: 'digitalInput3', bool: true },
  4: { name: 'digitalInput4', bool: true },
  9: { name: 'analogInput1Mv' },
  10: { name: 'analogInput2Mv' },
  16: { name: 'odometerKm', scale: 0.001 }, // total odometer, metres → km
  17: { name: 'accelerometerX', signed: true },
  18: { name: 'accelerometerY', signed: true },
  19: { name: 'accelerometerZ', signed: true },
  21: { name: 'gsmSignal' }, // 0–5
  66: { name: 'powerVoltage', scale: 0.001 }, // external supply, mV → V
  67: { name: 'batteryVoltage', scale: 0.001 }, // internal battery, mV → V
  68: { name: 'batteryCurrentMa' },
  69: { name: 'gnssStatus' },
  72: { name: 'temperature1', scale: 0.1, signed: true }, // Dallas / LLS, 0.1 °C
  73: { name: 'temperature2', scale: 0.1, signed: true },
  74: { name: 'temperature3', scale: 0.1, signed: true },
  81: { name: 'canSpeedKph' },
  82: { name: 'acceleratorPedalPct' },
  83: { name: 'fuelConsumedL', scale: 0.1 },
  84: { name: 'fuelLevelL', scale: 0.1 },
  85: { name: 'rpm' },
  87: { name: 'canTotalMileageKm', scale: 0.001 },
  89: { name: 'fuelLevelPct' },
  113: { name: 'batteryLevelPct' },
  115: { name: 'engineTemperature', scale: 0.1, signed: true },
  181: { name: 'pdop', scale: 0.1 },
  182: { name: 'hdop', scale: 0.1 },
  199: { name: 'tripOdometerKm', scale: 0.001 },
  200: { name: 'sleepMode' },
  239: { name: 'ignitionOn', bool: true },
  240: { name: 'movement', bool: true },
  241: { name: 'gsmOperator' },
};

export const IO_IGNITION = 239;

/** Value 0 = the condition ended; only a non-zero value raises an alarm. */
type AlarmFor = (value: number) => Alarm | null;

const alarm = (code: string, io: number, severity: Alarm['severity']): Alarm => ({
  code,
  source: `teltonika:io${io}`,
  severity,
});

/**
 * Event IO id → alarm. A record raises an alarm only when it was triggered by
 * the matching event IO (the record's "event IO id") with a non-zero value.
 */
export const ALARM_EVENTS: Readonly<Record<number, AlarmFor>> = {
  247: () => alarm('ACCIDENT', 247, 'CRITICAL'), // crash detection
  246: () => alarm('TOWING', 246, 'WARNING'), // towing detection
  252: () => alarm('POWER_CUT', 252, 'CRITICAL'), // battery/power unplugged
  249: () => alarm('GSM_JAMMING', 249, 'WARNING'), // jamming detection
  255: () => alarm('OVERSPEED', 255, 'WARNING'), // value = speed
  236: () => alarm('ALARM_INPUT', 236, 'WARNING'), // alarm input
  // Green driving (253): value is the type.
  253: (value) => {
    switch (value) {
      case 1:
        return alarm('ACCELERATION', 253, 'WARNING');
      case 2:
        return alarm('BRAKING', 253, 'WARNING');
      case 3:
        return alarm('CORNERING', 253, 'WARNING');
      default:
        return null;
    }
  },
};
