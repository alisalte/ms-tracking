/**
 * JT808 alarm-flag / status-flag / event-id code tables
 * (JT/T 808-2019 §"报警标志" / "状态位" / "事件报告").
 *
 * The 0x0200 location body carries a 32-bit alarm-flag word whose bits flag
 * active alarms; the 32-bit status word's bits encode device/fix state. The
 * 0x0301 event report carries a single event-id byte. These tables map both to
 * the canonical Alarm shape (06 §10.2). A representative subset of the standard
 * bit/event table is encoded; unmapped alarms still decode (generic label) — the
 * map only upgrades the code/severity.
 */
import type { Alarm } from '../../../domain/device-message.js';

/** Alarm-flag DWORD bit → canonical alarm (bit index → label + severity). */
export const ALARM_FLAG_BITS: Readonly<
  Record<number, { code: string; severity: Alarm['severity'] }>
> = {
  0: { code: 'EMERGENCY', severity: 'CRITICAL' }, // 紧急报警 / SOS (one-touch)
  1: { code: 'OVERSPEED', severity: 'WARNING' }, // 超速报警
  2: { code: 'FATIGUE', severity: 'WARNING' }, // 疲劳驾驶
  3: { code: 'DANGER', severity: 'CRITICAL' }, // 危险预警 (pre-crash / forward collision)
  4: { code: 'GPS_FAULT', severity: 'WARNING' }, // GNSS模块发生故障
  5: { code: 'GNSS_UNDERVOLTAGE', severity: 'WARNING' }, // GNSS天线未接/欠压
  6: { code: 'TERMINAL_UNDERVOLTAGE', severity: 'WARNING' }, // 终端主电源欠压
  7: { code: 'TERMINAL_POWER_OFF', severity: 'CRITICAL' }, // 终端主电源断电
  8: { code: 'DISPLAY_FAULT', severity: 'INFO' }, // 终端LCD/显示器故障
  9: { code: 'TTS_FAULT', severity: 'INFO' }, // 语音模块故障
  10: { code: 'CAMERA_FAULT', severity: 'INFO' }, // 摄像头故障
  18: { code: 'ACCIDENT', severity: 'CRITICAL' }, // 事故 (collision)
  19: { code: 'ROLLOVER', severity: 'CRITICAL' }, // 侧翻
  23: { code: 'ILLEGAL_IGNITION', severity: 'WARNING' }, // 非法点火
  24: { code: 'ILLEGAL_DISPLACEMENT', severity: 'WARNING' }, // 非法位移
};

/**
 * Map an alarm-flag DWORD to a list of canonical Alarms (one per set known bit;
 * unknown set bits get a generic ALARM_BIT_n label). Returns [] when no bits are
 * set (a clean position report).
 */
export function decodeAlarmFlag(alarm: number): Alarm[] {
  if (alarm === 0) return [];
  const out: Alarm[] = [];
  for (let bit = 0; bit < 32; bit++) {
    const mask = 1 << bit;
    if ((alarm & mask) === 0) continue;
    // JS bitwise is 32-bit signed; coerce bit index safely.
    const entry = ALARM_FLAG_BITS[bit];
    if (entry) {
      out.push({ code: entry.code, source: `bit${bit}`, severity: entry.severity });
    } else {
      out.push({ code: `ALARM_BIT_${bit}`, source: `bit${bit}`, severity: 'INFO' });
    }
  }
  return out;
}

/** Status-word bit meanings used by position decoding. */
export const STATUS_BIT = {
  ACC: 0, // bit0 — ACC/ignition on
  FIX_VALID: 1, // bit1 — GPS fix valid (lat/lng trusted)
  LAT_SOUTH: 2, // bit2 — latitude is south (negative)
  LNG_WEST: 3, // bit3 — longitude is west (negative)
} as const;

/** Event-id (0x0301 body) → canonical alarm (representative subset). */
export const EVENT_IDS: Readonly<Record<number, { code: string; severity: Alarm['severity'] }>> = {
  1: { code: 'EMERGENCY', severity: 'CRITICAL' },
  2: { code: 'OVERSPEED', severity: 'WARNING' },
  3: { code: 'FATIGUE', severity: 'WARNING' },
  4: { code: 'DANGER', severity: 'CRITICAL' },
  5: { code: 'GPS_FAULT', severity: 'WARNING' },
  17: { code: 'ACCIDENT', severity: 'CRITICAL' },
  18: { code: 'ROLLOVER', severity: 'CRITICAL' },
  130: { code: 'ILLEGAL_IGNITION', severity: 'WARNING' },
  131: { code: 'ILLEGAL_DISPLACEMENT', severity: 'WARNING' },
};

/** Map a 0x0301 event id to a canonical Alarm; unknown ids get a generic label. */
export function decodeEventId(eventId: number): Alarm {
  const entry = EVENT_IDS[eventId];
  if (entry) {
    return { code: entry.code, source: `0x${eventId.toString(16)}`, severity: entry.severity };
  }
  return {
    code: `EVENT_0x${eventId.toString(16)}`,
    source: `0x${eventId.toString(16)}`,
    severity: 'INFO',
  };
}

/** Common 0x0200 IO item ids (TLV) we know how to interpret (representative). */
export const IO_ID = {
  MILEAGE: 0x01, // DWORD, 0.1 km units
  FUEL: 0x02, // WORD, raw/10 liters (meter reading)
  RECORDED_SPEED: 0x03, // WORD, raw/10 km/h
  ALARM_EVENT_ID: 0x04, // WORD — alarm/event id requiring manual ack
  RSSI: 0x30, // BYTE
  SATELLITES: 0x31, // BYTE GNSS satellite count
} as const;
