/**
 * Meitrack MDVR GPRS command catalog (MEITRACK MDVR GPRS Protocol V2.0,
 * 2024-03-20 — applicable to MD511H/MD522S/MD811H/MD822S/MD533S/MD500S).
 *
 * Single source of truth for every TCP-settable command the platform exposes:
 *   - metadata (code / names / category / param shape) → served to the UI,
 *     which renders dynamic parameter forms from it (GET /device-commands/catalog);
 *   - `validateParams` — semantic validation beyond the zod envelope;
 *   - `buildPayload` — validated params → the wire payload written after
 *     `<imei>,` in the `@@` frame (`A11,10`), or a hex body for the binary
 *     media structs (§3.16–§3.31).
 *
 * Section references in the per-command comments cite the protocol PDF.
 */
import type { CommandCategory, CommandDef, CommandPayload } from './device-command-types.js';

// ---------------------------------------------------------------------------
// Wire builders — shared helpers
// ---------------------------------------------------------------------------

type Params = Record<string, unknown>;

/** Read a trimmed string param ('' → undefined). */
function str(p: Params, key: string): string | undefined {
  const v = p[key];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

/** Read a number param (undefined/'' → undefined). */
function num(p: Params, key: string): number | undefined {
  const s = str(p, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Format a coordinate with the 6 decimal digits the protocol requires (§3.33). */
function coord(v: number): string {
  return v.toFixed(6);
}

/** BCD-encode a YYMMDDHHMMSS digit string into 6 bytes (§3.18 t_start[6]). */
function bcdTime(value: string | undefined): number[] {
  if (!value) return [0, 0, 0, 0, 0, 0];
  const digits = value.replace(/\D/g, '').padEnd(12, '0').slice(0, 12);
  const bytes: number[] = [];
  for (let i = 0; i < 12; i += 2) {
    // BCD: each nibble is one decimal digit — "19" encodes as 0x19.
    bytes.push(Number.parseInt(digits.slice(i, i + 2), 16));
  }
  return bytes;
}

/** BCD-encode YY+MM (2 bytes) — §3.26 AA4[,YYMM]. */
function bcdYearMonth(value: string | undefined): number[] {
  if (!value) return [];
  const digits = value.replace(/\D/g, '').padEnd(4, '0').slice(0, 4);
  return [Number.parseInt(digits.slice(0, 2), 16), Number.parseInt(digits.slice(2, 4), 16)];
}

function byte(n: number): number[] {
  return [n & 0xff];
}

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

/** ASCII bytes of a string. */
function ascii(s: string): number[] {
  return [...Buffer.from(s, 'ascii')];
}

/** Length-prefixed ASCII string: len(1B) + bytes (§3.16 ip_len / §4.6). */
function lpAscii(s: string): number[] {
  const bytes = ascii(s);
  return [bytes.length, ...bytes];
}

function toHex(bytes: readonly number[]): string {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

/** Binary payload: the command code + comma + raw struct bytes, hex-encoded. */
function hexBody(code: string, structBytes: readonly number[]): CommandPayload {
  return { kind: 'hex', hex: toHex([...ascii(`${code},`), ...structBytes]) };
}

/** Split a comma/semicolon/whitespace-separated list into trimmed tokens. */
function list(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- shared option tables ----------------------------------------------------

const ON_OFF = (onFa = 'فعال', offFa = 'غیرفعال') => [
  { value: '0', label: 'Off', labelFa: offFa },
  { value: '1', label: 'On', labelFa: onFa },
];

const AV_TYPE = [
  { value: '0', label: 'Audio + Video', labelFa: 'صدا و تصویر' },
  { value: '1', label: 'Audio', labelFa: 'فقط صدا' },
  { value: '2', label: 'Video', labelFa: 'فقط تصویر' },
  { value: '3', label: 'Video or A/V', labelFa: 'تصویر یا صدا و تصویر' },
];

const STREAM_TYPE = [
  { value: '0', label: 'All / Major-or-minor', labelFa: 'همه / اصلی یا فرعی' },
  { value: '1', label: 'Major stream', labelFa: 'استریم اصلی' },
  { value: '2', label: 'Minor stream', labelFa: 'استریم فرعی' },
];

const CAP_TYPE = [
  { value: '0', label: 'All memories', labelFa: 'همه حافظه‌ها' },
  { value: '1', label: 'Active memory', labelFa: 'حافظه فعال' },
  { value: '2', label: 'Standby memory', labelFa: 'حافظه پشتیبان' },
];

const OUT_STATE = [
  { value: '0', label: 'Close', labelFa: 'قطع' },
  { value: '1', label: 'Open', labelFa: 'وصل' },
  { value: '2', label: 'Keep', labelFa: 'حفظ' },
];

// ---------------------------------------------------------------------------
// Catalog definition — every TCP-settable MDVR command (protocol §3.1–§3.89)
// ---------------------------------------------------------------------------

const query = (
  code: string,
  name: string,
  nameFa: string,
  description: string,
  descriptionFa: string,
  category: CommandCategory = 'system',
): CommandDef => ({
  code,
  name,
  nameFa,
  category,
  description,
  descriptionFa,
  params: [],
  expectResponse: true,
  supportsReadback: true,
});

/** A11/A21 family: GPRS set replies `OK`; Read must query DB4 instead. */
const READ_VIA_DB4 = 'DB4' as const;

export const MEITRACK_COMMAND_CATALOG: readonly CommandDef[] = [
  // ==========================================================================
  // TRACKING (§3.1–§3.8)
  // ==========================================================================
  {
    code: 'A10',
    name: 'Real-Time Location Query',
    nameFa: 'کوئری موقعیت لحظه‌ای',
    category: 'tracking',
    description: 'Request one current-position CCE packet (event code 34).',
    descriptionFa: 'درخواست یک پکت موقعیت فعلی (کد رویداد ۳۴).',
    params: [],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'A11',
    name: 'Heartbeat Interval',
    nameFa: 'بازه هارت‌بیت',
    category: 'tracking',
    description: 'Heartbeat packet interval; 0 disables. Read uses DB4 (empty A11 only ACKs OK).',
    descriptionFa:
      'بازه پکت هارت‌بیت؛ صفر غیرفعال می‌کند. خواندن با DB4 است (A11 خالی فقط OK برمی‌گرداند).',
    params: [
      {
        key: 'minutes',
        label: 'Interval',
        labelFa: 'بازه',
        type: 'number',
        min: 0,
        max: 65535,
        unit: 'min',
        required: false,
        defaultValue: 10,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },
  {
    code: 'A12',
    name: 'Tracking by Time Interval',
    nameFa: 'ردیابی با بازه زمانی',
    category: 'tracking',
    description: 'Scheduled GPRS reporting; 0 disables. 6 (60s) recommended.',
    descriptionFa: 'گزارش‌دهی زمان‌بندی‌شده؛ صفر غیرفعال. مقدار پیشنهادی ۶ (۶۰ ثانیه).',
    params: [
      {
        key: 'interval',
        label: 'Interval',
        labelFa: 'بازه',
        type: 'number',
        min: 0,
        max: 65535,
        unit: '×10s',
        required: false,
        defaultValue: 6,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },
  {
    code: 'A13',
    name: 'Cornering Report',
    nameFa: 'گزارش پیچ‌ها',
    category: 'tracking',
    description: 'Report when heading changes more than the angle; 0 disables.',
    descriptionFa: 'ارسال گزارش وقتی زاویه بیشتر از مقدار تغییر کند؛ صفر غیرفعال.',
    params: [
      {
        key: 'angle',
        label: 'Angle',
        labelFa: 'زاویه',
        type: 'number',
        min: 0,
        max: 359,
        unit: '°',
        required: false,
        defaultValue: 30,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },
  {
    code: 'A14',
    name: 'Tracking by Distance',
    nameFa: 'ردیابی با مسافت',
    category: 'tracking',
    description: 'Report every N meters travelled; 0 disables. 300 recommended.',
    descriptionFa: 'ارسال گزارش هر N متر؛ صفر غیرفعال. مقدار پیشنهادی ۳۰۰.',
    params: [
      {
        key: 'distance',
        label: 'Distance',
        labelFa: 'مسافت',
        type: 'number',
        min: 0,
        max: 65535,
        unit: 'm',
        required: false,
        defaultValue: 300,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },
  {
    code: 'A15',
    name: 'Parking Scheduled Tracking',
    nameFa: 'ردیابی زمان‌بندی پارک',
    category: 'tracking',
    description: 'Report interval while engine is off; 0 disables.',
    descriptionFa: 'بازه گزارش وقتی موتور خاموش است؛ صفر غیرفعال.',
    params: [
      {
        key: 'interval',
        label: 'Interval',
        labelFa: 'بازه',
        type: 'number',
        min: 0,
        max: 65535,
        unit: '×10s',
        required: false,
        defaultValue: 6,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },
  {
    code: 'A16',
    name: 'Enable Parking Scheduled Tracking',
    nameFa: 'فعال‌سازی ردیابی پارک',
    category: 'tracking',
    description: 'Switches between A12 (engine on) and A15 (engine off) intervals.',
    descriptionFa: 'سوییچ بین بازه A12 (موتور روشن) و A15 (موتور خاموش).',
    params: [
      {
        key: 'status',
        label: 'Status',
        labelFa: 'وضعیت',
        type: 'enum',
        options: ON_OFF(),
        required: false,
        defaultValue: '1',
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },
  {
    code: 'A17',
    name: 'Output 1 by RFID/iButton',
    nameFa: 'خروجی ۱ با RFID',
    category: 'tracking',
    description: 'Engine immobilizer via authorized RFID swipe; 0 disables.',
    descriptionFa: 'قطع/وصل موتور با کارت RFID مجاز؛ صفر غیرفعال.',
    params: [
      {
        key: 'enabled',
        label: 'Function',
        labelFa: 'قابلیت',
        type: 'enum',
        options: ON_OFF(),
        required: false,
        defaultValue: '0',
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },

  // ==========================================================================
  // NETWORK / SERVER (§3.9–§3.11, §3.32, §3.25)
  // ==========================================================================
  {
    code: 'A21',
    name: 'GPRS Server Parameters',
    nameFa: 'پارامترهای سرور GPRS',
    category: 'network',
    description:
      'Primary server connection mode, address, port and APN. Read uses DB4 — empty A21 only ACKs OK.',
    descriptionFa:
      'حالت اتصال، آدرس، پورت و APN سرور اصلی. خواندن با DB4 است — A21 خالی فقط OK برمی‌گرداند.',
    params: [
      {
        key: 'mode',
        label: 'Connection mode',
        labelFa: 'حالت اتصال',
        type: 'enum',
        options: [
          { value: '0', label: 'Disabled', labelFa: 'غیرفعال' },
          { value: '1', label: 'TCP', labelFa: 'TCP' },
          { value: '2', label: 'UDP', labelFa: 'UDP' },
        ],
        required: false,
        defaultValue: '1',
      },
      {
        key: 'host',
        label: 'IP / domain',
        labelFa: 'IP / دامنه',
        type: 'string',
        maxLength: 32,
        required: false,
      },
      {
        key: 'port',
        label: 'Port',
        labelFa: 'پورت',
        type: 'number',
        min: 1,
        max: 65535,
        required: false,
      },
      { key: 'apn', label: 'APN', labelFa: 'APN', type: 'string', maxLength: 32, required: false },
      {
        key: 'apnUser',
        label: 'APN user',
        labelFa: 'کاربر APN',
        type: 'string',
        maxLength: 32,
        required: false,
      },
      {
        key: 'apnPassword',
        label: 'APN password',
        labelFa: 'رمز APN',
        type: 'string',
        maxLength: 32,
        required: false,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },
  {
    code: 'A23',
    name: 'Standby GPRS Server',
    nameFa: 'سرور پشتیبان GPRS',
    category: 'network',
    description: 'Fallback server used when the primary (A21) is unreachable.',
    descriptionFa: 'سرور جایگزین وقتی سرور اصلی (A21) در دسترس نیست.',
    params: [
      {
        key: 'host',
        label: 'IP / domain',
        labelFa: 'IP / دامنه',
        type: 'string',
        maxLength: 32,
        required: false,
      },
      {
        key: 'port',
        label: 'Port',
        labelFa: 'پورت',
        type: 'number',
        min: 1,
        max: 65535,
        required: false,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },
  {
    code: 'A25',
    name: 'IP3 Server Parameters',
    nameFa: 'پارامترهای سرور سوم (IP3)',
    category: 'network',
    description: 'Third server connection mode, address, port and APN.',
    descriptionFa: 'حالت اتصال، آدرس، پورت و APN سرور سوم.',
    params: [
      {
        key: 'mode',
        label: 'Connection mode',
        labelFa: 'حالت اتصال',
        type: 'enum',
        options: [
          { value: '0', label: 'Disabled', labelFa: 'غیرفعال' },
          { value: '1', label: 'TCP', labelFa: 'TCP' },
          { value: '2', label: 'UDP', labelFa: 'UDP' },
        ],
        required: false,
        defaultValue: '1',
      },
      {
        key: 'host',
        label: 'IP / domain',
        labelFa: 'IP / دامنه',
        type: 'string',
        maxLength: 32,
        required: false,
      },
      {
        key: 'port',
        label: 'Port',
        labelFa: 'پورت',
        type: 'number',
        min: 1,
        max: 65535,
        required: false,
      },
      { key: 'apn', label: 'APN', labelFa: 'APN', type: 'string', maxLength: 32, required: false },
      {
        key: 'apnUser',
        label: 'APN user',
        labelFa: 'کاربر APN',
        type: 'string',
        maxLength: 32,
        required: false,
      },
      {
        key: 'apnPassword',
        label: 'APN password',
        labelFa: 'رمز APN',
        type: 'string',
        maxLength: 32,
        required: false,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
    readbackCommand: READ_VIA_DB4,
  },
  {
    code: 'ABB',
    name: 'WiFi Hotspot',
    nameFa: 'نقطه دسترسی وای‌فای',
    category: 'network',
    description: 'Enable the device WiFi hotspot with SSID/password. Empty = read.',
    descriptionFa: 'فعال‌سازی هات‌اسپات وای‌فای با SSID/رمز. خالی = خواندن تنظیمات.',
    params: [
      {
        key: 'enabled',
        label: 'Hotspot',
        labelFa: 'هات‌اسپات',
        type: 'enum',
        options: ON_OFF(),
        required: false,
      },
      {
        key: 'ssid',
        label: 'SSID',
        labelFa: 'SSID',
        type: 'string',
        maxLength: 64,
        required: false,
        hint: 'No commas',
        hintFa: 'بدون ویرگول',
      },
      {
        key: 'password',
        label: 'Password',
        labelFa: 'رمز',
        type: 'string',
        maxLength: 32,
        required: false,
        hint: '8–32 chars, no commas',
        hintFa: '۸ تا ۳۲ کاراکتر، بدون ویرگول',
      },
    ],
    expectResponse: false,
    supportsReadback: true,
  },
  query(
    'AA3',
    'Network Status',
    'وضعیت شبکه',
    'Read GSM/WiFi/LAN status, SIM, signal, IPs.',
    'خواندن وضعیت GSM/وای‌فای/LAN، سیم‌کارت، سیگنال و IPها.',
    'network',
  ),

  // ==========================================================================
  // PHONE / SMS (§3.12–§3.14, §3.50, §3.46, §3.47)
  // ==========================================================================
  query(
    'A70',
    'Read Authorized Phone Numbers',
    'خواندن شماره‌های مجاز',
    'Read all SOS + listen-in numbers.',
    'خواندن همه شماره‌های SOS و شنود.',
    'phone',
  ),
  {
    code: 'A71',
    name: 'Authorized Phone Numbers',
    nameFa: 'شماره‌های تلفن مجاز',
    category: 'phone',
    description: 'SOS numbers 1–3 (device dials them in sequence on SOS).',
    descriptionFa: 'شماره‌های SOS ۱ تا ۳ (دستگاه هنگام SOS به‌ترتیب تماس می‌گیرد).',
    params: [
      {
        key: 'phone1',
        label: 'SOS number 1',
        labelFa: 'شماره SOS ۱',
        type: 'string',
        maxLength: 16,
        required: false,
      },
      {
        key: 'phone2',
        label: 'SOS number 2',
        labelFa: 'شماره SOS ۲',
        type: 'string',
        maxLength: 16,
        required: false,
      },
      {
        key: 'phone3',
        label: 'SOS number 3',
        labelFa: 'شماره SOS ۳',
        type: 'string',
        maxLength: 16,
        required: false,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'A72',
    name: 'Listen-in Phone Numbers',
    nameFa: 'شماره‌های شنود',
    category: 'phone',
    description: 'Up to 2 numbers that silently answer calls.',
    descriptionFa: 'تا ۲ شماره که تماس را بی‌صدا پاسخ می‌دهند.',
    params: [
      {
        key: 'phone1',
        label: 'Listen-in 1',
        labelFa: 'شنود ۱',
        type: 'string',
        maxLength: 16,
        required: false,
      },
      {
        key: 'phone2',
        label: 'Listen-in 2',
        labelFa: 'شنود ۲',
        type: 'string',
        maxLength: 16,
        required: false,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'C02',
    name: 'Send SMS via Device',
    nameFa: 'ارسال پیامک از طریق دستگاه',
    category: 'phone',
    description: 'Device sends an SMS to the given phone number.',
    descriptionFa: 'دستگاه پیامکی به شماره داده‌شده ارسال می‌کند.',
    params: [
      {
        key: 'mode',
        label: 'Encoding',
        labelFa: 'کدگذاری',
        type: 'enum',
        options: [
          { value: '0', label: 'TEXT', labelFa: 'TEXT' },
          { value: '1', label: 'Unicode', labelFa: 'Unicode' },
        ],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'phone',
        label: 'Phone number',
        labelFa: 'شماره تلفن',
        type: 'string',
        maxLength: 16,
        required: true,
      },
      {
        key: 'content',
        label: 'Message',
        labelFa: 'متن پیام',
        type: 'string',
        maxLength: 140,
        allowComma: true,
        required: true,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B91',
    name: 'SMS Event Characters',
    nameFa: 'متن رویداد در پیامک',
    category: 'phone',
    description: 'Custom SMS header for an event code (≤16 bytes).',
    descriptionFa: 'سرصفحه پیامک سفارشی برای یک کد رویداد (حداکثر ۱۶ بایت).',
    params: [
      {
        key: 'eventCode',
        label: 'Event code',
        labelFa: 'کد رویداد',
        type: 'number',
        min: 1,
        max: 999,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'header',
        label: 'SMS header',
        labelFa: 'سرصفحه پیامک',
        type: 'string',
        maxLength: 16,
        required: true,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B99',
    name: 'Event Authorization',
    nameFa: 'مجوز رویدادها',
    category: 'phone',
    description: 'Per-event SMS/CALL/GPRS/CAMERA/BUZZER/OUT authorization rules.',
    descriptionFa: 'قواعد مجوز رویداد برای پیامک/تماس/GPRS/دوربین/بازر/خروجی.',
    params: [
      {
        key: 'target',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'enum',
        options: [
          { value: '0', label: 'SMS', labelFa: 'پیامک' },
          { value: '1', label: 'CALL', labelFa: 'تماس' },
          { value: '2', label: 'GPRS', labelFa: 'GPRS' },
          { value: '3', label: 'CAMERA', labelFa: 'دوربین' },
          { value: '4', label: 'BUZZER', labelFa: 'بازر' },
          { value: '5', label: 'OUT1', labelFa: 'خروجی ۱' },
          { value: '6', label: 'OUT2', labelFa: 'خروجی ۲' },
        ],
        required: true,
        defaultValue: '2',
      },
      {
        key: 'phone',
        label: 'Phone (SMS/CALL)',
        labelFa: 'شماره (پیامک/تماس)',
        type: 'string',
        maxLength: 16,
        required: false,
      },
      {
        key: 'operation',
        label: 'Operation',
        labelFa: 'عملیات',
        type: 'enum',
        options: [
          { value: '0', label: 'GET', labelFa: 'خواندن' },
          { value: '1', label: 'SET', labelFa: 'تنظیم' },
          { value: '2', label: 'ADD', labelFa: 'افزودن' },
          { value: '3', label: 'DEL', labelFa: 'حذف' },
        ],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'eventCodes',
        label: 'Event codes',
        labelFa: 'کدهای رویداد',
        type: 'string',
        maxLength: 256,
        allowComma: true,
        required: false,
        hint: 'Comma-separated',
        hintFa: 'جدا با ویرگول',
      },
    ],
    expectResponse: true,
    supportsReadback: true,
  },

  // ==========================================================================
  // ALERTS (§3.35–§3.37, §3.58–§3.60, §3.62, §3.76)
  // ==========================================================================
  {
    code: 'B07',
    name: 'Speeding Alert',
    nameFa: 'هشدار سرعت',
    category: 'alerts',
    description: 'Speed threshold (event 19); 0 disables.',
    descriptionFa: 'آستانه سرعت (رویداد ۱۹)؛ صفر غیرفعال.',
    params: [
      {
        key: 'speed',
        label: 'Speed',
        labelFa: 'سرعت',
        type: 'number',
        min: 0,
        max: 255,
        unit: 'km/h',
        required: true,
        defaultValue: 60,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B08',
    name: 'Towing Alert',
    nameFa: 'هشدار یدک‌کشی',
    category: 'alerts',
    description: 'Vibration time threshold (event 36); 0 disables. Needs deep sleep (A73=2).',
    descriptionFa: 'آستانه زمان لرزش (رویداد ۳۶)؛ صفر غیرفعال. نیاز به خواب عمیق (A73=2).',
    params: [
      {
        key: 'seconds',
        label: 'Vibration time',
        labelFa: 'زمان لرزش',
        type: 'number',
        min: 0,
        max: 255,
        unit: 's',
        required: true,
        defaultValue: 3,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B10',
    name: 'Fast Towing Alert',
    nameFa: 'هشدار سریع یدک‌کشی',
    category: 'alerts',
    description: 'Towing alert + power-saving idle timeout in one command.',
    descriptionFa: 'هشدار یدک‌کشی + تایم بیکاری ذخیره انرژی در یک دستور.',
    params: [
      {
        key: 'seconds',
        label: 'Vibration time',
        labelFa: 'زمان لرزش',
        type: 'number',
        min: 0,
        max: 255,
        unit: 's',
        required: true,
        defaultValue: 3,
      },
      {
        key: 'idleMinutes',
        label: 'Idle time',
        labelFa: 'زمان بیکاری',
        type: 'number',
        min: 0,
        max: 255,
        unit: 'min',
        required: false,
        defaultValue: 2,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'C47',
    name: 'Fuel Parameters',
    nameFa: 'پارامترهای سوخت',
    category: 'fuel',
    description: 'Fuel sensor type + full/low alert percentages (events 52/53).',
    descriptionFa: 'نوع سنسور سوخت + درصد هشدار پر/خالی (رویداد ۵۲/۵۳).',
    params: [
      {
        key: 'sensorType',
        label: 'Sensor type',
        labelFa: 'نوع سنسور',
        type: 'enum',
        options: [
          { value: '0', label: 'None', labelFa: 'بدون سنسور' },
          { value: '1', label: 'C-type (capacitive)', labelFa: 'نوع C (خازنی)' },
          { value: '2', label: 'R-type (resistive)', labelFa: 'نوع R (مقاومتی)' },
          { value: '3', label: 'V-type (voltage)', labelFa: 'نوع V (ولتاژی)' },
        ],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'upperLimit',
        label: 'Full alert at',
        labelFa: 'هشدار پر شدن',
        type: 'number',
        min: 0,
        max: 100,
        unit: '%',
        required: false,
      },
      {
        key: 'lowerLimit',
        label: 'Low alert at',
        labelFa: 'هشدار کم شدن',
        type: 'number',
        min: 0,
        max: 100,
        unit: '%',
        required: false,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  query(
    'C48',
    'Read Fuel Parameters',
    'خواندن پارامترهای سوخت',
    'Read sensor type + alert thresholds.',
    'خواندن نوع سنسور و آستانه‌های هشدار.',
    'fuel',
  ),
  {
    code: 'C49',
    name: 'Fuel Theft Alert',
    nameFa: 'هشدار سرقت سوخت',
    category: 'fuel',
    description: 'Fuel-drop check window and percentage (event 54).',
    descriptionFa: 'پنجره بررسی افت سوخت و درصد آن (رویداد ۵۴).',
    params: [
      {
        key: 'checkMinutes',
        label: 'Check time',
        labelFa: 'زمان بررسی',
        type: 'number',
        min: 0,
        max: 255,
        unit: 'min',
        required: true,
        defaultValue: 3,
      },
      {
        key: 'decreasePercent',
        label: 'Drop threshold',
        labelFa: 'آستانه افت',
        type: 'number',
        min: 0,
        max: 100,
        unit: '%',
        required: true,
        defaultValue: 2,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'D79',
    name: 'Harsh Acceleration / Braking',
    nameFa: 'شتاب/ترمز شدید',
    category: 'alerts',
    description: 'mG thresholds for harsh acceleration (events 129/130).',
    descriptionFa: 'آستانه mG برای شتاب و ترمز شدید (رویداد ۱۲۹/۱۳۰).',
    params: [
      {
        key: 'acceleration',
        label: 'Harsh acceleration',
        labelFa: 'شتاب شدید',
        type: 'number',
        min: 90,
        max: 1000,
        unit: 'mG',
        required: true,
        defaultValue: 150,
      },
      {
        key: 'braking',
        label: 'Harsh braking',
        labelFa: 'ترمز شدید',
        type: 'number',
        min: -1500,
        max: -100,
        unit: 'mG',
        required: true,
        defaultValue: -180,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'C90',
    name: 'Driver Fatigue Function',
    nameFa: 'قابلیت خستگی راننده',
    category: 'alerts',
    description: 'DMS alert volume + absence/distraction/smoking/phone toggles.',
    descriptionFa: 'بلندی صدای هشدار DMS + سوییچ‌های غیبت/حواس‌پرتی/سیگار/مکالمه.',
    params: [
      {
        key: 'volume',
        label: 'Alert volume',
        labelFa: 'بلندی هشدار',
        type: 'enum',
        options: [
          { value: '0', label: 'Silent', labelFa: 'بی‌صدا' },
          { value: '1', label: 'Medium', labelFa: 'متوسط' },
          { value: '2', label: 'High', labelFa: 'بلند' },
          { value: '225', label: 'DIP switch', labelFa: 'کلید DIP' },
        ],
        required: true,
        defaultValue: '2',
      },
      {
        key: 'absence',
        label: 'Absence alert',
        labelFa: 'هشدار غیبت',
        type: 'enum',
        options: ON_OFF(),
        required: false,
        defaultValue: '1',
      },
      {
        key: 'distraction',
        label: 'Distraction alert',
        labelFa: 'هشدار حواس‌پرتی',
        type: 'enum',
        options: ON_OFF(),
        required: false,
        defaultValue: '1',
      },
      {
        key: 'smoking',
        label: 'Smoking alert',
        labelFa: 'هشدار سیگار',
        type: 'enum',
        options: ON_OFF(),
        required: false,
        defaultValue: '1',
      },
      {
        key: 'phoneCall',
        label: 'Phone call alert',
        labelFa: 'هشدار مکالمه',
        type: 'enum',
        options: ON_OFF(),
        required: false,
        defaultValue: '1',
      },
    ],
    expectResponse: true,
    supportsReadback: true,
  },

  // ==========================================================================
  // GEO-FENCE (§3.33, §3.34, §3.38)
  // ==========================================================================
  {
    code: 'B05',
    name: 'Circular Geo-Fence',
    nameFa: 'حصار جغرافیایی دایره‌ای',
    category: 'geofence',
    description: 'Center + radius fence with enter/exit alerts (events 20/21).',
    descriptionFa: 'حصار با مرکز و شعاع + هشدار ورود/خروج (رویداد ۲۰/۲۱).',
    params: [
      {
        key: 'fenceNumber',
        label: 'Fence number',
        labelFa: 'شماره حصار',
        type: 'number',
        min: 1,
        max: 8,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'latitude',
        label: 'Latitude',
        labelFa: 'عرض جغرافیایی',
        type: 'number',
        min: -90,
        max: 90,
        integer: false,
        required: true,
      },
      {
        key: 'longitude',
        label: 'Longitude',
        labelFa: 'طول جغرافیایی',
        type: 'number',
        min: -180,
        max: 180,
        integer: false,
        required: true,
      },
      {
        key: 'radius',
        label: 'Radius',
        labelFa: 'شعاع',
        type: 'number',
        min: 1,
        max: 4294967295,
        unit: 'm',
        required: true,
        defaultValue: 1000,
      },
      {
        key: 'enterAlert',
        label: 'Enter alert',
        labelFa: 'هشدار ورود',
        type: 'enum',
        options: ON_OFF(),
        required: true,
        defaultValue: '0',
      },
      {
        key: 'exitAlert',
        label: 'Exit alert',
        labelFa: 'هشدار خروج',
        type: 'enum',
        options: ON_OFF(),
        required: true,
        defaultValue: '1',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B06',
    name: 'Delete Geo-Fence',
    nameFa: 'حذف حصار جغرافیایی',
    category: 'geofence',
    description: 'Delete one geo-fence by number (1–8).',
    descriptionFa: 'حذف یک حصار با شماره (۱ تا ۸).',
    params: [
      {
        key: 'fenceNumber',
        label: 'Fence number',
        labelFa: 'شماره حصار',
        type: 'number',
        min: 1,
        max: 8,
        required: true,
        defaultValue: 1,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B11',
    name: 'Polygonal Geo-Fence',
    nameFa: 'حصار جغرافیایی چندضلعی',
    category: 'geofence',
    description: 'Polygon vertices list; sending only the number deletes the fence.',
    descriptionFa: 'لیست رئوس چندضلعی؛ ارسال فقط شماره، حصار را حذف می‌کند.',
    params: [
      {
        key: 'fenceNumber',
        label: 'Fence number',
        labelFa: 'شماره حصار',
        type: 'number',
        min: 1,
        max: 8,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'points',
        label: 'Vertices (lat,lng pairs)',
        labelFa: 'رئوس (جفت‌های lat,lng)',
        type: 'string',
        maxLength: 900,
        allowComma: true,
        required: false,
        hint: 'lat1,lng1;lat2,lng2;…',
        hintFa: 'lat1,lng1;lat2,lng2;…',
      },
      {
        key: 'enterAlert',
        label: 'Enter alert',
        labelFa: 'هشدار ورود',
        type: 'enum',
        options: ON_OFF(),
        required: false,
        defaultValue: '1',
      },
      {
        key: 'exitAlert',
        label: 'Exit alert',
        labelFa: 'هشدار خروج',
        type: 'enum',
        options: ON_OFF(),
        required: false,
        defaultValue: '1',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },

  // ==========================================================================
  // DEVICE (§3.15, §3.39–§3.44, §3.72, §3.73, §3.75, §3.87)
  // ==========================================================================
  {
    code: 'A73',
    name: 'Smart Sleep Mode',
    nameFa: 'حالت خواب هوشمند',
    category: 'device',
    description: '0 off, 1 normal sleep, 2 deep sleep (GPS off, GSM sleeps).',
    descriptionFa: '۰ خاموش، ۱ خواب معمولی، ۲ خواب عمیق (GPS خاموش، GSM می‌خوابد).',
    params: [
      {
        key: 'level',
        label: 'Sleep level',
        labelFa: 'سطح خواب',
        type: 'enum',
        options: [
          { value: '0', label: 'Disabled', labelFa: 'غیرفعال' },
          { value: '1', label: 'Normal sleep', labelFa: 'خواب معمولی' },
          { value: '2', label: 'Deep sleep', labelFa: 'خواب عمیق' },
        ],
        required: true,
        defaultValue: '0',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B22',
    name: 'Mileage & Speed Mode',
    nameFa: 'حالت محاسبه مسافت و سرعت',
    category: 'device',
    description: '0 GPS speed, 1 auto-calibrate K via GPS, 2 calibrate via SOS, ≥3 fixed K.',
    descriptionFa: '۰ سرعت GPS، ۱ کالیبراسیون خودکار K، ۲ کالیبراسیون با SOS، ≥۳ ضریب K ثابت.',
    params: [
      {
        key: 'mode',
        label: 'Mode / K',
        labelFa: 'حالت / ضریب K',
        type: 'number',
        min: 0,
        max: 65535,
        required: true,
        defaultValue: 0,
        hint: '0/1/2 or K≥3',
        hintFa: '۰/۱/۲ یا K≥۳',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'B26',
    name: 'Input Port Filter Time',
    nameFa: 'زمان فیلتر ورودی‌ها',
    category: 'device',
    description: 'Debounce time per input port 1–5. Empty = read current values.',
    descriptionFa: 'زمان فیلتر هر ورودی ۱ تا ۵. خالی = خواندن مقادیر فعلی.',
    params: [
      {
        key: 'port1',
        label: 'Port 1',
        labelFa: 'ورودی ۱',
        type: 'number',
        min: 0,
        max: 65535,
        unit: '×10ms',
        required: false,
      },
      {
        key: 'port2',
        label: 'Port 2',
        labelFa: 'ورودی ۲',
        type: 'number',
        min: 0,
        max: 65535,
        unit: '×10ms',
        required: false,
      },
      {
        key: 'port3',
        label: 'Port 3',
        labelFa: 'ورودی ۳',
        type: 'number',
        min: 0,
        max: 65535,
        unit: '×10ms',
        required: false,
      },
      {
        key: 'port4',
        label: 'Port 4',
        labelFa: 'ورودی ۴',
        type: 'number',
        min: 0,
        max: 65535,
        unit: '×10ms',
        required: false,
      },
      {
        key: 'port5',
        label: 'Port 5',
        labelFa: 'ورودی ۵',
        type: 'number',
        min: 0,
        max: 65535,
        unit: '×10ms',
        required: false,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
  },
  {
    code: 'B31',
    name: 'LED Indicator',
    nameFa: 'چراغ نشانگر',
    category: 'device',
    description: '00 indicator on (default), 10 indicator off.',
    descriptionFa: '۰۰ روشن (پیش‌فرض)، ۱۰ خاموش.',
    params: [
      {
        key: 'state',
        label: 'State',
        labelFa: 'وضعیت',
        type: 'enum',
        options: [
          { value: '00', label: 'On', labelFa: 'روشن' },
          { value: '10', label: 'Off', labelFa: 'خاموش' },
        ],
        required: true,
        defaultValue: '00',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B34',
    name: 'Log Interval',
    nameFa: 'بازه ثبت لاگ',
    category: 'device',
    description: 'GPS log recording interval; 0 disables.',
    descriptionFa: 'بازه ثبت لاگ GPS؛ صفر غیرفعال.',
    params: [
      {
        key: 'interval',
        label: 'Interval',
        labelFa: 'بازه',
        type: 'number',
        min: 0,
        max: 65535,
        unit: 's',
        required: true,
        defaultValue: 60,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B35',
    name: 'Local Time Zone',
    nameFa: 'منطقه زمانی محلی',
    category: 'device',
    description: 'Minutes offset for recording/SMS times (e.g. 480 = UTC+8).',
    descriptionFa: 'اختلاف دقیقه برای زمان ثبت/پیامک (مثلاً ۴۸۰ = UTC+8). برای ایران ۲۱۰.',
    params: [
      {
        key: 'minutes',
        label: 'Offset',
        labelFa: 'اختلاف',
        type: 'number',
        min: -32768,
        max: 32767,
        unit: 'min',
        required: true,
        defaultValue: 210,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'B36',
    name: 'GPRS Time Zone',
    nameFa: 'منطقه زمانی GPRS',
    category: 'device',
    description: 'Minutes offset applied to GPRS packets (0 recommended).',
    descriptionFa: 'اختلاف دقیقه روی پکت‌های GPRS (پیشنهاد: ۰).',
    params: [
      {
        key: 'minutes',
        label: 'Offset',
        labelFa: 'اختلاف',
        type: 'number',
        min: -32768,
        max: 32767,
        unit: 'min',
        required: true,
        defaultValue: 0,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'D73',
    name: 'Storage Allocation',
    nameFa: 'تخصیص حافظه',
    category: 'device',
    description: 'Split flash between GPRS cache and GPS logs (must total 100).',
    descriptionFa: 'تقسیم حافظه بین کش GPRS و لاگ GPS (جمع = ۱۰۰).',
    params: [
      {
        key: 'gprsPercent',
        label: 'GPRS cache',
        labelFa: 'کش GPRS',
        type: 'number',
        min: 0,
        max: 100,
        unit: '%',
        required: true,
        defaultValue: 50,
      },
      {
        key: 'logPercent',
        label: 'GPS logs',
        labelFa: 'لاگ GPS',
        type: 'number',
        min: 0,
        max: 100,
        unit: '%',
        required: true,
        defaultValue: 50,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'F08',
    name: 'Set Mileage & Run Time',
    nameFa: 'تنظیم مسافت و کارکرد',
    category: 'device',
    description: 'Correct the odometer / engine runtime base values.',
    descriptionFa: 'اصلاح مقادیر پایه کیلومترشمار و ساعت کارکرد.',
    params: [
      {
        key: 'runtime',
        label: 'Run time',
        labelFa: 'کارکرد',
        type: 'number',
        min: 0,
        max: 4294967295,
        unit: 's',
        required: false,
      },
      {
        key: 'mileage',
        label: 'Mileage',
        labelFa: 'مسافت',
        type: 'number',
        min: 0,
        max: 4294967295,
        unit: 'm',
        required: false,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'D65',
    name: 'Maintenance Mileage',
    nameFa: 'کیلومتر نگهداری',
    category: 'device',
    description: 'Eight upcoming maintenance mileage points (meters).',
    descriptionFa: 'هشت نقطه کیلومتر نگهداری بعدی (متر).',
    params: [
      {
        key: 'points',
        label: 'Mileage points',
        labelFa: 'نقاط کیلومتری',
        type: 'string',
        maxLength: 200,
        allowComma: true,
        required: true,
        hint: '8 comma-separated values',
        hintFa: '۸ مقدار جدا با ویرگول',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'D66',
    name: 'Maintenance Time',
    nameFa: 'زمان نگهداری',
    category: 'device',
    description: 'Eight maintenance time points (days since 1990-01-01).',
    descriptionFa: 'هشت نقطه زمانی نگهداری (روز از ۱۹۹۰-۰۱-۰۱).',
    params: [
      {
        key: 'points',
        label: 'Time points',
        labelFa: 'نقاط زمانی',
        type: 'string',
        maxLength: 200,
        allowComma: true,
        required: true,
        hint: '8 comma-separated day counts',
        hintFa: '۸ عدد روز جدا با ویرگول',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },

  // ==========================================================================
  // OUTPUTS (§3.49, §3.74)
  // ==========================================================================
  {
    code: 'C01',
    name: 'Output Control',
    nameFa: 'کنترل خروجی‌ها',
    category: 'outputs',
    description: 'Set output ports 1–5 (0 close, 1 open, 2 keep) below a speed limit.',
    descriptionFa: 'تنظیم خروجی‌های ۱ تا ۵ (۰ قطع، ۱ وصل، ۲ حفظ) زیر سرعت مشخص.',
    params: [
      {
        key: 'speed',
        label: 'Speed limit',
        labelFa: 'حد سرعت',
        type: 'number',
        min: 0,
        max: 255,
        unit: 'km/h',
        required: true,
        defaultValue: 0,
        hint: '0 = immediate',
        hintFa: '۰ = بلافاصله',
      },
      {
        key: 'out1',
        label: 'Output 1',
        labelFa: 'خروجی ۱',
        type: 'enum',
        options: OUT_STATE,
        required: true,
        defaultValue: '2',
      },
      {
        key: 'out2',
        label: 'Output 2',
        labelFa: 'خروجی ۲',
        type: 'enum',
        options: OUT_STATE,
        required: false,
        defaultValue: '2',
      },
      {
        key: 'out3',
        label: 'Output 3',
        labelFa: 'خروجی ۳',
        type: 'enum',
        options: OUT_STATE,
        required: false,
        defaultValue: '2',
      },
      {
        key: 'out4',
        label: 'Output 4',
        labelFa: 'خروجی ۴',
        type: 'enum',
        options: OUT_STATE,
        required: false,
        defaultValue: '2',
      },
      {
        key: 'out5',
        label: 'Output 5',
        labelFa: 'خروجی ۵',
        type: 'enum',
        options: OUT_STATE,
        required: false,
        defaultValue: '2',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'D72',
    name: 'Output Triggering',
    nameFa: 'تریگر خروجی',
    category: 'outputs',
    description: 'Event-triggered output pulse / PWM configuration.',
    descriptionFa: 'پیکربندی پالس/PWM خروجی هنگام رویداد.',
    params: [
      {
        key: 'port',
        label: 'Output port',
        labelFa: 'پورت خروجی',
        type: 'enum',
        options: [
          { value: '1', label: 'Output 1', labelFa: 'خروجی ۱' },
          { value: '2', label: 'Output 2', labelFa: 'خروجی ۲' },
        ],
        required: true,
        defaultValue: '1',
      },
      {
        key: 'time',
        label: 'Output time',
        labelFa: 'مدت خروجی',
        type: 'number',
        min: 0,
        max: 4294967295,
        unit: '×10ms',
        required: true,
        defaultValue: 100,
      },
      {
        key: 'level',
        label: 'Level',
        labelFa: 'سطح',
        type: 'enum',
        options: [
          { value: '0', label: 'High', labelFa: 'بالا' },
          { value: '1', label: 'Low', labelFa: 'پایین' },
          { value: '2', label: 'PWM', labelFa: 'PWM' },
        ],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'dutyCycle',
        label: 'PWM duty',
        labelFa: 'دوتی PWM',
        type: 'number',
        min: 0,
        max: 100,
        unit: '%',
        required: false,
        defaultValue: 0,
      },
      {
        key: 'pwmPeriod',
        label: 'PWM period',
        labelFa: 'دوره PWM',
        type: 'number',
        min: 2000,
        max: 50000000,
        unit: 'µs',
        required: false,
        defaultValue: 10000,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },

  // ==========================================================================
  // RFID (§3.65–§3.71)
  // ==========================================================================
  {
    code: 'D10',
    name: 'Authorize RFID Cards',
    nameFa: 'مجوز کارت‌های RFID',
    category: 'rfid',
    description: 'Authorize up to 50 RFID/iButton ids at once.',
    descriptionFa: 'مجازسازی تا ۵۰ شناسه RFID/iButton به‌طور همزمان.',
    params: [
      {
        key: 'ids',
        label: 'RFID ids',
        labelFa: 'شناسه‌های RFID',
        type: 'string',
        maxLength: 700,
        allowComma: true,
        required: true,
        hint: 'Comma-separated',
        hintFa: 'جدا با ویرگول',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'D11',
    name: 'Authorize RFID in Batches',
    nameFa: 'مجوز گروهی RFID',
    category: 'rfid',
    description: 'Authorize a consecutive id range starting at a number.',
    descriptionFa: 'مجازسازی بازه متوالی شناسه‌ها از یک شماره.',
    params: [
      {
        key: 'start',
        label: 'Start number',
        labelFa: 'شماره شروع',
        type: 'number',
        min: 1,
        max: 4294967295,
        required: true,
        defaultValue: 13737431,
      },
      {
        key: 'count',
        label: 'Count',
        labelFa: 'تعداد',
        type: 'number',
        min: 1,
        max: 128,
        required: true,
        defaultValue: 1,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'D12',
    name: 'Check RFID Authorization',
    nameFa: 'بررسی مجوز RFID',
    category: 'rfid',
    description: 'Check whether one RFID id is authorized.',
    descriptionFa: 'بررسی مجاز بودن یک شناسه RFID.',
    params: [
      {
        key: 'id',
        label: 'RFID id',
        labelFa: 'شناسه RFID',
        type: 'number',
        min: 1,
        max: 4294967295,
        required: true,
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'D13',
    name: 'Read Authorized RFID',
    nameFa: 'خواندن RFIDهای مجاز',
    category: 'rfid',
    description: 'Read the authorized id list starting at a packet number.',
    descriptionFa: 'خواندن لیست شناسه‌های مجاز از یک شماره پکت.',
    params: [
      {
        key: 'packetStart',
        label: 'Packet start',
        labelFa: 'شروع پکت',
        type: 'number',
        min: 0,
        max: 4294967295,
        required: true,
        defaultValue: 0,
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'D14',
    name: 'Delete RFID Cards',
    nameFa: 'حذف کارت‌های RFID',
    category: 'rfid',
    description: 'Delete up to 50 authorized ids.',
    descriptionFa: 'حذف تا ۵۰ شناسه مجاز.',
    params: [
      {
        key: 'ids',
        label: 'RFID ids',
        labelFa: 'شناسه‌های RFID',
        type: 'string',
        maxLength: 700,
        allowComma: true,
        required: true,
        hint: 'Comma-separated',
        hintFa: 'جدا با ویرگول',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'D15',
    name: 'Delete RFID in Batches',
    nameFa: 'حذف گروهی RFID',
    category: 'rfid',
    description: 'Delete a consecutive id range.',
    descriptionFa: 'حذف بازه متوالی شناسه‌ها.',
    params: [
      {
        key: 'start',
        label: 'Start number',
        labelFa: 'شماره شروع',
        type: 'number',
        min: 1,
        max: 4294967295,
        required: true,
      },
      {
        key: 'count',
        label: 'Count',
        labelFa: 'تعداد',
        type: 'number',
        min: 1,
        max: 65536,
        required: true,
        defaultValue: 1,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  query(
    'D16',
    'RFID Database Checksum',
    'چک‌سام پایگاه RFID',
    'XOR checksum of the authorized id database.',
    'چک‌سام XOR پایگاه شناسه‌های مجاز.',
    'rfid',
  ),

  // ==========================================================================
  // TEMPERATURE (§3.52–§3.57)
  // ==========================================================================
  {
    code: 'C40',
    name: 'Register Temperature Sensor',
    nameFa: 'ثبت سنسور دما',
    category: 'temperature',
    description: 'Bind sensor SNs to numbers (raw protocol format).',
    descriptionFa: 'اتصال SN سنسورها به شماره‌ها (فرمت خام پروتکل).',
    params: [
      {
        key: 'data',
        label: 'SN & number entries',
        labelFa: 'ورودی‌های SN و شماره',
        type: 'string',
        maxLength: 300,
        required: true,
        hint: 'Raw protocol string, no commas',
        hintFa: 'رشته خام پروتکل، بدون ویرگول',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'C41',
    name: 'Delete Temperature Sensor',
    nameFa: 'حذف سنسور دما',
    category: 'temperature',
    description: 'Delete registered sensor numbers; empty deletes all.',
    descriptionFa: 'حذف شماره سنسورهای ثبت‌شده؛ خالی = حذف همه.',
    params: [
      {
        key: 'numbers',
        label: 'Sensor numbers (hex)',
        labelFa: 'شماره سنسورها (مبنای ۱۶)',
        type: 'string',
        maxLength: 100,
        allowComma: true,
        required: false,
        hint: 'Comma-separated hex',
        hintFa: 'جدا با ویرگول، مبنای ۱۶',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  query(
    'C42',
    'Read Temperature Sensors',
    'خواندن سنسورهای دما',
    'Read SN ↔ number mappings.',
    'خواندن نگاشت SN ↔ شماره.',
    'temperature',
  ),
  {
    code: 'C43',
    name: 'Temperature Threshold',
    nameFa: 'آستانه دما',
    category: 'temperature',
    description: 'Set high/low thresholds + alerts + logical name (raw format).',
    descriptionFa: 'تنظیم آستانه بالا/پایین + هشدارها + نام منطقی (فرمت خام).',
    params: [
      {
        key: 'data',
        label: 'Raw entry',
        labelFa: 'ورودی خام',
        type: 'string',
        maxLength: 500,
        required: true,
        hint: 'Raw protocol string, no commas',
        hintFa: 'رشته خام پروتکل، بدون ویرگول',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  query(
    'C44',
    'Read Temperature Parameters',
    'خواندن پارامترهای دما',
    'Read thresholds, alerts and names.',
    'خواندن آستانه‌ها، هشدارها و نام‌ها.',
    'temperature',
  ),
  query(
    'C46',
    'Check Temperature Sensors',
    'بررسی سنسورهای دما',
    'CRC-CCITT checksum of sensor parameters.',
    'چک‌سام CRC-CCITT پارامتر سنسورها.',
    'temperature',
  ),

  // ==========================================================================
  // TPMS (§3.77–§3.82)
  // ==========================================================================
  query(
    'DA0',
    'TPMS Alert Parameters',
    'پارامترهای هشدار TPMS',
    'Read axle pressure + temperature thresholds.',
    'خواندن آستانه فشار محورها و دما.',
    'tpms',
  ),
  query(
    'DA1',
    'TPMS Bound Sensors',
    'سنسورهای TPMS متصل',
    'Read all bound tire sensors data.',
    'خواندن داده همه سنسورهای لاستیک.',
    'tpms',
  ),
  {
    code: 'DA2',
    name: 'TPMS Single Sensor',
    nameFa: 'یک سنسور TPMS',
    category: 'tpms',
    description: 'Read one tire sensor by installation location (hex).',
    descriptionFa: 'خواندن یک سنسور با محل نصب (مبنای ۱۶).',
    params: [
      {
        key: 'location',
        label: 'Location (hex)',
        labelFa: 'محل (مبنای ۱۶)',
        type: 'string',
        maxLength: 2,
        required: true,
        hint: 'e.g. 01',
        hintFa: 'مثلاً 01',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'DA3',
    name: 'Delete TPMS Sensors',
    nameFa: 'حذف سنسورهای TPMS',
    category: 'tpms',
    description: 'Unbind tire sensors by locations (hex, comma-separated).',
    descriptionFa: 'حذف اتصال سنسورها با محل‌ها (مبنای ۱۶، جدا با ویرگول).',
    params: [
      {
        key: 'locations',
        label: 'Locations (hex)',
        labelFa: 'محل‌ها (مبنای ۱۶)',
        type: 'string',
        maxLength: 200,
        allowComma: true,
        required: true,
        hint: 'Comma-separated hex',
        hintFa: 'جدا با ویرگول، مبنای ۱۶',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'DA4',
    name: 'TPMS Bind Sensors',
    nameFa: 'اتصال سنسورهای TPMS',
    category: 'tpms',
    description: 'Bind sensors: location+id pairs (raw hex).',
    descriptionFa: 'اتصال سنسورها: جفت‌های محل+شناسه (هگز خام).',
    params: [
      {
        key: 'data',
        label: 'Location+ID pairs (hex)',
        labelFa: 'جفت‌های محل+شناسه (هگز)',
        type: 'string',
        maxLength: 700,
        allowComma: true,
        required: true,
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'DA5',
    name: 'TPMS Alert Thresholds',
    nameFa: 'آستانه‌های هشدار TPMS',
    category: 'tpms',
    description: 'Set axle high/low pressure + temperature thresholds (hex bytes).',
    descriptionFa: 'تنظیم فشار بالا/پایین محورها و آستانه دما (بایت‌های هگز).',
    params: [
      {
        key: 'data',
        label: 'Thresholds (hex)',
        labelFa: 'آستانه‌ها (هگز)',
        type: 'string',
        maxLength: 40,
        required: true,
        hint: '11 hex bytes',
        hintFa: '۱۱ بایت هگز',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },

  // ==========================================================================
  // MEDIA / VIDEO (§3.16–§3.22, §3.26–§3.31, §3.48, §3.63) — binary structs
  // ==========================================================================
  {
    code: 'A9A',
    name: 'Live Audio/Video Stream',
    nameFa: 'پخش زنده صدا و تصویر',
    category: 'media',
    description: 'Start real-time A/V streaming to a media server (TCP).',
    descriptionFa: 'شروع استریم زنده صدا/تصویر به سرور رسانه (TCP).',
    params: [
      {
        key: 'server',
        label: 'Media server',
        labelFa: 'سرور رسانه',
        type: 'string',
        maxLength: 64,
        required: true,
      },
      {
        key: 'tcpPort',
        label: 'TCP port',
        labelFa: 'پورت TCP',
        type: 'number',
        min: 1,
        max: 65535,
        required: true,
      },
      {
        key: 'udpPort',
        label: 'UDP port',
        labelFa: 'پورت UDP',
        type: 'number',
        min: 0,
        max: 65535,
        required: false,
        defaultValue: 0,
      },
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 1,
        max: 129,
        required: true,
        defaultValue: 1,
        hint: '1–64 A/V, 65–128 listen, 129 talk',
        hintFa: '۱–۶۴ صدا/تصویر، ۶۵–۱۲۸ شنود، ۱۲۹ مکالمه',
      },
      {
        key: 'dataType',
        label: 'Data type',
        labelFa: 'نوع داده',
        type: 'enum',
        options: [
          { value: '0', label: 'Audio + Video', labelFa: 'صدا و تصویر' },
          { value: '1', label: 'Video', labelFa: 'فقط تصویر' },
          { value: '2', label: 'Two-way calling', labelFa: 'مکالمه دوطرفه' },
          { value: '3', label: 'Listen-in', labelFa: 'شنود' },
        ],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'streamType',
        label: 'Stream',
        labelFa: 'استریم',
        type: 'enum',
        options: [
          { value: '0', label: 'Major', labelFa: 'اصلی' },
          { value: '1', label: 'Minor', labelFa: 'فرعی' },
        ],
        required: true,
        defaultValue: '1',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'A9B',
    name: 'Live Stream Control',
    nameFa: 'کنترل پخش زنده',
    category: 'media',
    description: 'Stop / switch bitrate of a live channel.',
    descriptionFa: 'توقف / تغییر بیت‌ریت کانال زنده.',
    params: [
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 1,
        max: 129,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'control',
        label: 'Control',
        labelFa: 'کنترل',
        type: 'enum',
        options: [
          { value: '0', label: 'Stop', labelFa: 'توقف' },
          { value: '1', label: 'Switch bitrate', labelFa: 'تغییر بیت‌ریت' },
          { value: '4', label: 'End two-way call', labelFa: 'پایان مکالمه' },
        ],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'closeType',
        label: 'Close type',
        labelFa: 'نوع بستن',
        type: 'enum',
        options: [
          { value: '0', label: 'All data', labelFa: 'همه داده‌ها' },
          { value: '1', label: 'Audio only', labelFa: 'فقط صدا' },
          { value: '2', label: 'Video only', labelFa: 'فقط تصویر' },
        ],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'switchType',
        label: 'New stream',
        labelFa: 'استریم جدید',
        type: 'enum',
        options: [
          { value: '0', label: 'Major', labelFa: 'اصلی' },
          { value: '1', label: 'Minor', labelFa: 'فرعی' },
        ],
        required: true,
        defaultValue: '0',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'A9C',
    name: 'Query Video Resource List',
    nameFa: 'کوئری لیست ویدیوها',
    category: 'media',
    description: 'Search stored video files by channel/time/type.',
    descriptionFa: 'جستجوی فایل‌های ویدیویی ذخیره‌شده بر اساس کانال/زمان/نوع.',
    params: [
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 0,
        max: 64,
        required: true,
        defaultValue: 1,
        hint: '0 = all',
        hintFa: '۰ = همه',
      },
      {
        key: 'startTime',
        label: 'Start (YYMMDDHHMMSS)',
        labelFa: 'شروع (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: false,
        hint: 'Empty = no condition',
        hintFa: 'خالی = بدون شرط',
      },
      {
        key: 'endTime',
        label: 'End (YYMMDDHHMMSS)',
        labelFa: 'پایان (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: false,
        hint: 'Empty = no condition',
        hintFa: 'خالی = بدون شرط',
      },
      {
        key: 'avType',
        label: 'Type',
        labelFa: 'نوع',
        type: 'enum',
        options: AV_TYPE,
        required: true,
        defaultValue: '0',
      },
      {
        key: 'streamType',
        label: 'Stream',
        labelFa: 'استریم',
        type: 'enum',
        options: STREAM_TYPE,
        required: true,
        defaultValue: '0',
      },
      {
        key: 'capType',
        label: 'Memory',
        labelFa: 'حافظه',
        type: 'enum',
        options: CAP_TYPE,
        required: true,
        defaultValue: '0',
      },
      {
        key: 'alarmCodes',
        label: 'Alarm codes',
        labelFa: 'کدهای هشدار',
        type: 'string',
        maxLength: 200,
        allowComma: true,
        required: false,
        hint: 'Comma-separated; empty = all',
        hintFa: 'جدا با ویرگول؛ خالی = همه',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'A9D',
    name: 'Remote Video Playback',
    nameFa: 'پخش از راه دور ویدیو',
    category: 'media',
    description: 'Stream stored video back to the platform for playback.',
    descriptionFa: 'پخش ویدیوی ذخیره‌شده به سمت پلتفرم.',
    params: [
      {
        key: 'server',
        label: 'Media server',
        labelFa: 'سرور رسانه',
        type: 'string',
        maxLength: 64,
        required: true,
      },
      {
        key: 'tcpPort',
        label: 'TCP port',
        labelFa: 'پورت TCP',
        type: 'number',
        min: 1,
        max: 65535,
        required: true,
      },
      {
        key: 'udpPort',
        label: 'UDP port',
        labelFa: 'پورت UDP',
        type: 'number',
        min: 0,
        max: 65535,
        required: false,
        defaultValue: 0,
      },
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 1,
        max: 64,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'avType',
        label: 'Type',
        labelFa: 'نوع',
        type: 'enum',
        options: AV_TYPE,
        required: true,
        defaultValue: '3',
      },
      {
        key: 'streamType',
        label: 'Stream',
        labelFa: 'استریم',
        type: 'enum',
        options: STREAM_TYPE,
        required: true,
        defaultValue: '0',
      },
      {
        key: 'capType',
        label: 'Memory',
        labelFa: 'حافظه',
        type: 'enum',
        options: CAP_TYPE,
        required: true,
        defaultValue: '0',
      },
      {
        key: 'reviewStyle',
        label: 'Playback mode',
        labelFa: 'حالت پخش',
        type: 'enum',
        options: [{ value: '0', label: 'Normal', labelFa: 'معمولی' }],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'startTime',
        label: 'Start (YYMMDDHHMMSS)',
        labelFa: 'شروع (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: true,
      },
      {
        key: 'endTime',
        label: 'End (YYMMDDHHMMSS)',
        labelFa: 'پایان (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: true,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'A9E',
    name: 'Playback Control',
    nameFa: 'کنترل پخش',
    category: 'media',
    description: 'Pause/stop/drag a remote playback session.',
    descriptionFa: 'توقف/پایان/جابه‌جایی پخش از راه دور.',
    params: [
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 1,
        max: 64,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'control',
        label: 'Control',
        labelFa: 'کنترل',
        type: 'enum',
        options: [
          { value: '2', label: 'End playback', labelFa: 'پایان پخش' },
          { value: '5', label: 'Drag to time', labelFa: 'پرش به زمان' },
        ],
        required: true,
        defaultValue: '2',
      },
      {
        key: 'dragPoint',
        label: 'Drag point (YYMMDDHHMMSS)',
        labelFa: 'زمان پرش (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: false,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'A9F',
    name: 'Upload Files to FTP',
    nameFa: 'آپلود فایل‌ها به FTP',
    category: 'media',
    description: 'Device uploads matching video files to an FTP server.',
    descriptionFa: 'دستگاه فایل‌های ویدیویی مطابق را به سرور FTP آپلود می‌کند.',
    params: [
      {
        key: 'server',
        label: 'FTP server',
        labelFa: 'سرور FTP',
        type: 'string',
        maxLength: 64,
        required: true,
      },
      {
        key: 'port',
        label: 'FTP port',
        labelFa: 'پورت FTP',
        type: 'number',
        min: 1,
        max: 65535,
        required: true,
        defaultValue: 21,
      },
      {
        key: 'username',
        label: 'Username',
        labelFa: 'نام کاربری',
        type: 'string',
        maxLength: 64,
        required: true,
      },
      {
        key: 'password',
        label: 'Password',
        labelFa: 'رمز',
        type: 'string',
        maxLength: 64,
        required: true,
      },
      {
        key: 'path',
        label: 'Upload path',
        labelFa: 'مسیر آپلود',
        type: 'string',
        maxLength: 256,
        required: true,
      },
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 0,
        max: 64,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'startTime',
        label: 'Start (YYMMDDHHMMSS)',
        labelFa: 'شروع (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: true,
      },
      {
        key: 'endTime',
        label: 'End (YYMMDDHHMMSS)',
        labelFa: 'پایان (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: true,
      },
      {
        key: 'execute',
        label: 'Network condition',
        labelFa: 'شرط شبکه',
        type: 'enum',
        options: [
          { value: '1', label: 'WiFi', labelFa: 'وای‌فای' },
          { value: '2', label: 'LAN', labelFa: 'LAN' },
          { value: '3', label: 'WiFi or LAN', labelFa: 'وای‌فای یا LAN' },
          { value: '4', label: '3G/4G', labelFa: '۳G/۴G' },
          { value: '5', label: 'WiFi or 3G/4G', labelFa: 'وای‌فای یا ۳G/۴G' },
          { value: '6', label: 'LAN or 3G/4G', labelFa: 'LAN یا ۳G/۴G' },
          { value: '7', label: 'Any', labelFa: 'همه' },
        ],
        required: true,
        defaultValue: '7',
      },
      {
        key: 'avType',
        label: 'Type',
        labelFa: 'نوع',
        type: 'enum',
        options: AV_TYPE,
        required: false,
        defaultValue: '0',
      },
      {
        key: 'streamType',
        label: 'Stream',
        labelFa: 'استریم',
        type: 'enum',
        options: STREAM_TYPE,
        required: false,
        defaultValue: '0',
      },
      {
        key: 'capType',
        label: 'Memory',
        labelFa: 'حافظه',
        type: 'enum',
        options: CAP_TYPE,
        required: false,
        defaultValue: '0',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'AA0',
    name: 'Upload Control',
    nameFa: 'کنترل آپلود',
    category: 'media',
    description: 'Cancel an in-progress file upload by name.',
    descriptionFa: 'لغو آپلود در جریان با نام فایل.',
    params: [
      {
        key: 'flag',
        label: 'Action',
        labelFa: 'عمل',
        type: 'enum',
        options: [{ value: '2', label: 'Cancel', labelFa: 'لغو' }],
        required: true,
        defaultValue: '2',
      },
      {
        key: 'fileName',
        label: 'File name',
        labelFa: 'نام فایل',
        type: 'string',
        maxLength: 128,
        required: true,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  query(
    'AA1',
    'WiFi List',
    'لیست وای‌فای',
    'Scan nearby WiFi hotspots.',
    'اسکن نقاط دسترسی وای‌فای اطراف.',
    'media',
  ),
  {
    code: 'AA4',
    name: 'Stored Video Days',
    nameFa: 'روزهای ویدیوی ذخیره‌شده',
    category: 'media',
    description: 'Which days have stored video; optional YYMM filter.',
    descriptionFa: 'کدام روزها ویدیو ذخیره دارند؛ فیلتر اختیاری YYMM.',
    params: [
      {
        key: 'yearMonth',
        label: 'Year+month (YYMM)',
        labelFa: 'سال+ماه (YYMM)',
        type: 'string',
        maxLength: 4,
        required: false,
        hint: 'Empty = all',
        hintFa: 'خالی = همه',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'AB2',
    name: 'Live Stream via RTMP',
    nameFa: 'پخش زنده با RTMP',
    category: 'media',
    description: 'Push a live channel to an RTMP server.',
    descriptionFa: 'ارسال کانال زنده به سرور RTMP.',
    params: [
      {
        key: 'uploadUrl',
        label: 'RTMP upload URL',
        labelFa: 'آدرس آپلود RTMP',
        type: 'string',
        maxLength: 256,
        required: true,
      },
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 1,
        max: 129,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'dataType',
        label: 'Data type',
        labelFa: 'نوع داده',
        type: 'enum',
        options: [
          { value: '0', label: 'Audio + Video', labelFa: 'صدا و تصویر' },
          { value: '1', label: 'Video', labelFa: 'فقط تصویر' },
          { value: '2', label: 'Two-way calling', labelFa: 'مکالمه دوطرفه' },
          { value: '3', label: 'Listen-in', labelFa: 'شنود' },
        ],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'streamType',
        label: 'Stream',
        labelFa: 'استریم',
        type: 'enum',
        options: [
          { value: '0', label: 'Major', labelFa: 'اصلی' },
          { value: '1', label: 'Minor', labelFa: 'فرعی' },
        ],
        required: true,
        defaultValue: '1',
      },
      {
        key: 'downloadUrl',
        label: 'RTMP download URL (type 2)',
        labelFa: 'آدرس دانلود RTMP (نوع ۲)',
        type: 'string',
        maxLength: 256,
        required: false,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'AB3',
    name: 'RTMP Stream Control',
    nameFa: 'کنترل استریم RTMP',
    category: 'media',
    description: 'Stop / switch bitrate of an RTMP live channel.',
    descriptionFa: 'توقف / تغییر بیت‌ریت کانال زنده RTMP.',
    params: [
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 1,
        max: 129,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'control',
        label: 'Control',
        labelFa: 'کنترل',
        type: 'enum',
        options: [
          { value: '0', label: 'Stop', labelFa: 'توقف' },
          { value: '1', label: 'Switch bitrate', labelFa: 'تغییر بیت‌ریت' },
          { value: '4', label: 'End two-way call', labelFa: 'پایان مکالمه' },
        ],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'closeType',
        label: 'Close type',
        labelFa: 'نوع بستن',
        type: 'enum',
        options: [
          { value: '0', label: 'All data', labelFa: 'همه داده‌ها' },
          { value: '1', label: 'Audio only', labelFa: 'فقط صدا' },
          { value: '2', label: 'Video only', labelFa: 'فقط تصویر' },
        ],
        required: false,
        defaultValue: '0',
      },
      {
        key: 'switchType',
        label: 'New stream',
        labelFa: 'استریم جدید',
        type: 'enum',
        options: [
          { value: '0', label: 'Major', labelFa: 'اصلی' },
          { value: '1', label: 'Minor', labelFa: 'فرعی' },
        ],
        required: false,
        defaultValue: '0',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'AB4',
    name: 'Video Playback via RTMP',
    nameFa: 'پخش ویدیو با RTMP',
    category: 'media',
    description: 'Push stored video to an RTMP server for playback.',
    descriptionFa: 'ارسال ویدیوی ذخیره‌شده به سرور RTMP برای پخش.',
    params: [
      {
        key: 'url',
        label: 'RTMP URL',
        labelFa: 'آدرس RTMP',
        type: 'string',
        maxLength: 256,
        required: true,
      },
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 1,
        max: 64,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'avType',
        label: 'Type',
        labelFa: 'نوع',
        type: 'enum',
        options: AV_TYPE,
        required: true,
        defaultValue: '3',
      },
      {
        key: 'streamType',
        label: 'Stream',
        labelFa: 'استریم',
        type: 'enum',
        options: STREAM_TYPE,
        required: true,
        defaultValue: '0',
      },
      {
        key: 'capType',
        label: 'Memory',
        labelFa: 'حافظه',
        type: 'enum',
        options: CAP_TYPE,
        required: true,
        defaultValue: '0',
      },
      {
        key: 'startTime',
        label: 'Start (YYMMDDHHMMSS)',
        labelFa: 'شروع (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: true,
      },
      {
        key: 'endTime',
        label: 'End (YYMMDDHHMMSS)',
        labelFa: 'پایان (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: true,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'AB5',
    name: 'RTMP Playback Control',
    nameFa: 'کنترل پخش RTMP',
    category: 'media',
    description: 'Stop / drag an RTMP playback session.',
    descriptionFa: 'توقف / پرش پخش RTMP.',
    params: [
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 1,
        max: 64,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'control',
        label: 'Control',
        labelFa: 'کنترل',
        type: 'enum',
        options: [
          { value: '2', label: 'End playback', labelFa: 'پایان پخش' },
          { value: '5', label: 'Drag to time', labelFa: 'پرش به زمان' },
        ],
        required: true,
        defaultValue: '2',
      },
      {
        key: 'dragPoint',
        label: 'Drag point (YYMMDDHHMMSS)',
        labelFa: 'زمان پرش (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: false,
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'AB8',
    name: 'Query Resource List (Packets)',
    nameFa: 'کوئری لیست منابع (پکتی)',
    category: 'media',
    description: 'Resource list query with resumable packet paging.',
    descriptionFa: 'کوئری لیست منابع با صفحه‌بندی پکتی قابل ادامه.',
    params: [
      {
        key: 'channel',
        label: 'Channel',
        labelFa: 'کانال',
        type: 'number',
        min: 0,
        max: 64,
        required: true,
        defaultValue: 0,
        hint: '0 = all',
        hintFa: '۰ = همه',
      },
      {
        key: 'startTime',
        label: 'Start (YYMMDDHHMMSS)',
        labelFa: 'شروع (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: false,
      },
      {
        key: 'endTime',
        label: 'End (YYMMDDHHMMSS)',
        labelFa: 'پایان (YYMMDDHHMMSS)',
        type: 'string',
        maxLength: 12,
        required: false,
      },
      {
        key: 'avType',
        label: 'Type',
        labelFa: 'نوع',
        type: 'enum',
        options: [...AV_TYPE, { value: '4', label: 'Photo', labelFa: 'عکس' }],
        required: true,
        defaultValue: '0',
      },
      {
        key: 'streamType',
        label: 'Stream',
        labelFa: 'استریم',
        type: 'enum',
        options: STREAM_TYPE,
        required: true,
        defaultValue: '0',
      },
      {
        key: 'capType',
        label: 'Memory',
        labelFa: 'حافظه',
        type: 'enum',
        options: CAP_TYPE,
        required: true,
        defaultValue: '0',
      },
      {
        key: 'alarmCodes',
        label: 'Alarm codes',
        labelFa: 'کدهای هشدار',
        type: 'string',
        maxLength: 200,
        allowComma: true,
        required: false,
        hint: 'Comma-separated; empty = all',
        hintFa: 'جدا با ویرگول؛ خالی = همه',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'B64',
    name: 'FTP Photo Upload',
    nameFa: 'آپلود عکس FTP',
    category: 'media',
    description: 'FTP server for photo uploads; empty = read, 2 = clear last params.',
    descriptionFa: 'سرور FTP برای آپلود عکس؛ خالی = خواندن، ۲ = پاک‌کردن پارامترها.',
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelFa: 'حالت',
        type: 'enum',
        options: [
          { value: '0', label: 'Off', labelFa: 'خاموش' },
          { value: '1', label: 'Upload', labelFa: 'آپلود' },
          { value: '2', label: 'Clear params', labelFa: 'پاک‌کردن' },
        ],
        required: true,
        defaultValue: '1',
      },
      {
        key: 'username',
        label: 'Username',
        labelFa: 'نام کاربری',
        type: 'string',
        maxLength: 50,
        required: false,
      },
      {
        key: 'password',
        label: 'Password',
        labelFa: 'رمز',
        type: 'string',
        maxLength: 50,
        required: false,
      },
      {
        key: 'host',
        label: 'FTP host',
        labelFa: 'میزبان FTP',
        type: 'string',
        maxLength: 50,
        required: false,
      },
      {
        key: 'port',
        label: 'Port',
        labelFa: 'پورت',
        type: 'string',
        maxLength: 5,
        required: false,
      },
      {
        key: 'path',
        label: 'Path',
        labelFa: 'مسیر',
        type: 'string',
        maxLength: 100,
        required: false,
      },
    ],
    expectResponse: false,
    supportsReadback: true,
  },
  {
    code: 'BB8',
    name: 'Speaker Volume',
    nameFa: 'بلندی صدای اسپیکر',
    category: 'media',
    description: 'MDVR speaker volume 0–100. Empty = read.',
    descriptionFa: 'بلندی اسپیکر MDVR از ۰ تا ۱۰۰. خالی = خواندن.',
    params: [
      {
        key: 'volume',
        label: 'Volume',
        labelFa: 'بلندی',
        type: 'number',
        min: 0,
        max: 100,
        unit: '%',
        required: false,
        defaultValue: 10,
      },
    ],
    expectResponse: true,
    supportsReadback: true,
  },
  // --------------------------------------------------------------------------
  // On-demand photo capture (D03 trigger → D01 list → D00 chunked download).
  // Rides the existing command channel (no dialback IP needed — works behind
  // CGNAT, unlike A9A/AB2 live video). Validated against a real MD300 in the
  // standalone md300/server/capture_photo.py pipeline this catalog ports.
  // --------------------------------------------------------------------------
  {
    code: 'D03',
    name: 'Capture Photo',
    nameFa: 'گرفتن عکس',
    category: 'media',
    description:
      'Trigger a snapshot on one camera; device replies D03,OK then the file ' +
      'appears in the D01 listing.',
    descriptionFa:
      'گرفتن عکس از یک دوربین؛ دستگاه با D03,OK پاسخ می‌دهد و فایل در فهرست D01 ظاهر می‌شود.',
    params: [
      {
        key: 'camera',
        label: 'Camera',
        labelFa: 'دوربین',
        type: 'number',
        min: 1,
        max: 8,
        required: true,
        defaultValue: 1,
      },
      {
        key: 'imagename',
        label: 'Image name',
        labelFa: 'نام فایل',
        type: 'string',
        maxLength: 60,
        required: true,
        defaultValue: 'photo.jpg',
        hint: 'Filename the device stores the capture under.',
        hintFa: 'نامی که دستگاه عکس را با آن ذخیره می‌کند.',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'D01',
    name: 'List Photos',
    nameFa: 'فهرست عکس‌ها',
    category: 'media',
    description: 'List captured photo filenames stored on the device.',
    descriptionFa: 'فهرست نام فایل‌های عکس ذخیره‌شده روی دستگاه.',
    params: [
      {
        key: 'startIndex',
        label: 'Start index',
        labelFa: 'اندیس شروع',
        type: 'number',
        min: 0,
        required: false,
        defaultValue: 0,
        hint: '0 = list from the first file.',
        hintFa: '۰ = فهرست از اولین فایل.',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'D00',
    name: 'Download Photo',
    nameFa: 'دانلود عکس',
    category: 'media',
    description:
      'Download a photo named by D01, in packets of raw command-channel chunks ' +
      '(reassemble the D00 responses in filename+packet order).',
    descriptionFa:
      'دانلود عکسی که با D01 نام‌گذاری شده، به‌صورت بسته‌های کانال دستور (پاسخ‌های D00 را به ترتیب بازچینی کنید).',
    params: [
      {
        key: 'filename',
        label: 'Filename',
        labelFa: 'نام فایل',
        type: 'string',
        maxLength: 60,
        required: true,
        hint: 'A name reported by D01.',
        hintFa: 'یکی از نام‌های گزارش‌شده توسط D01.',
      },
      {
        key: 'startPacket',
        label: 'Start packet',
        labelFa: 'بسته شروع',
        type: 'number',
        min: 0,
        required: false,
        defaultValue: 0,
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'CB8',
    name: 'Event Video Playing',
    nameFa: 'پخش ویدیوی رویداد',
    category: 'media',
    description: 'Map event codes to channel/time/priority playback. Empty = read.',
    descriptionFa: 'نگاشت کدهای رویداد به پخش کانال/زمان/اولویت. خالی = خواندن.',
    params: [
      {
        key: 'operation',
        label: 'Operation',
        labelFa: 'عملیات',
        type: 'enum',
        options: [
          { value: '1', label: 'Add / modify', labelFa: 'افزودن / ویرایش' },
          { value: '2', label: 'Delete', labelFa: 'حذف' },
        ],
        required: true,
        defaultValue: '1',
      },
      {
        key: 'entries',
        label: 'Entries',
        labelFa: 'ورودی‌ها',
        type: 'string',
        maxLength: 900,
        required: false,
        hint: 'event,channel,seconds,priority;…',
        hintFa: 'رویداد،کانال،ثانیه،اولویت;…',
      },
    ],
    expectResponse: true,
    supportsReadback: true,
  },

  // ==========================================================================
  // SYSTEM (§3.64, §3.51, §3.61, §3.83–§3.89)
  // ==========================================================================
  {
    code: 'C03',
    name: 'GPRS Event Mode',
    nameFa: 'حالت رویداد GPRS',
    category: 'system',
    description: '0 auto-report (default), 1 require server AFF/CFF confirmation (UDP).',
    descriptionFa: '۰ گزارش خودکار (پیش‌فرض)، ۱ نیازمند تأیید سرور (برای UDP).',
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelFa: 'حالت',
        type: 'enum',
        options: [
          { value: '0', label: 'Automatic', labelFa: 'خودکار' },
          { value: '1', label: 'Confirmed (UDP)', labelFa: 'با تأیید (UDP)' },
        ],
        required: true,
        defaultValue: '0',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'C61',
    name: 'Serial Transparent Transmission',
    nameFa: 'انتقال شفاف سریال',
    category: 'system',
    description: 'Send arbitrary data to the RS232 peripheral.',
    descriptionFa: 'ارسال داده دلخواه به تجهیز RS232.',
    params: [
      {
        key: 'data',
        label: 'Data packet',
        labelFa: 'پکت داده',
        type: 'string',
        maxLength: 512,
        required: true,
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  {
    code: 'CFF',
    name: 'Delete Buffered Events',
    nameFa: 'حذف رویدادهای بافر‌شده',
    category: 'system',
    description: 'Confirm + delete cached event records on the device.',
    descriptionFa: 'تأیید و حذف رکوردهای رویداد ذخیره‌شده روی دستگاه.',
    params: [
      {
        key: 'count',
        label: 'Quantity (hex)',
        labelFa: 'تعداد (مبنای ۱۶)',
        type: 'string',
        maxLength: 4,
        required: true,
        defaultValue: '1',
        hint: 'FFFF = all',
        hintFa: 'FFFF = همه',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
  query(
    'E91',
    'Firmware Version & SN',
    'نسخه فریم‌ور و SN',
    'Read the device firmware version and serial number.',
    'خواندن نسخه فریم‌ور و شماره سریال دستگاه.',
  ),
  query(
    'DA6',
    'Query Device Status',
    'وضعیت دستگاه',
    'Network, GPRS interval, GPS satellite count, voltages (GPRS V2.0 §3.165).',
    'شبکه، بازه GPRS، تعداد ماهواره و ولتاژ (§۳.۱۶۵).',
  ),
  query(
    'DB4',
    'Query Device Parameters',
    'پارامترهای دستگاه',
    'Dump of GPRS server, APN, heartbeat, tracking intervals and related settings (GPRS V2.0 §3.168).',
    'خروجی سرور GPRS، APN، هارت‌بیت، بازه‌های ردیابی و تنظیمات مرتبط (§۳.۱۶۸).',
  ),
  {
    code: 'F00',
    name: 'Restart GSM + GPS',
    nameFa: 'ری‌استارت GSM و GPS',
    category: 'system',
    description: 'Restart the GSM and/or GPS modules.',
    descriptionFa: 'ری‌استارت ماژول‌های GSM و/یا GPS.',
    params: [
      {
        key: 'gsm',
        label: 'Restart GSM',
        labelFa: 'ری‌استارت GSM',
        type: 'enum',
        options: ON_OFF('ری‌استارت', 'بدون تغییر'),
        required: true,
        defaultValue: '1',
      },
      {
        key: 'gps',
        label: 'Restart GPS',
        labelFa: 'ری‌استارت GPS',
        type: 'enum',
        options: ON_OFF('ری‌استارت', 'بدون تغییر'),
        required: true,
        defaultValue: '1',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'F01',
    name: 'Restart GSM Module',
    nameFa: 'ری‌استارت ماژول GSM',
    category: 'system',
    description: 'Restart the GSM module only.',
    descriptionFa: 'فقط ری‌استارت ماژول GSM.',
    params: [],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'F02',
    name: 'Restart GPS Module',
    nameFa: 'ری‌استارت ماژول GPS',
    category: 'system',
    description: 'Restart the GPS module only.',
    descriptionFa: 'فقط ری‌استارت ماژول GPS.',
    params: [],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'F09',
    name: 'Delete Cached Data',
    nameFa: 'حذف داده‌های کش',
    category: 'system',
    description: '1 = SMS cache, 2 = GPRS cache, 3 = both.',
    descriptionFa: '۱ = کش پیامک، ۲ = کش GPRS، ۳ = هر دو.',
    params: [
      {
        key: 'which',
        label: 'Cache',
        labelFa: 'کش',
        type: 'enum',
        options: [
          { value: '1', label: 'SMS', labelFa: 'پیامک' },
          { value: '2', label: 'GPRS', labelFa: 'GPRS' },
          { value: '3', label: 'Both', labelFa: 'هر دو' },
        ],
        required: true,
        defaultValue: '3',
      },
    ],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'F11',
    name: 'Restore Initial Settings',
    nameFa: 'بازگردانی تنظیمات کارخانه',
    category: 'system',
    description: 'Factory reset (keeps the SMS password).',
    descriptionFa: 'بازگردانی تنظیمات کارخانه (رمز پیامک حفظ می‌شود).',
    params: [],
    expectResponse: false,
    supportsReadback: false,
  },
  {
    code: 'RAW',
    name: 'Custom Command',
    nameFa: 'دستور سفارشی',
    category: 'custom',
    description: 'Send any raw protocol command body, e.g. "A16,1".',
    descriptionFa: 'ارسال بدینه خام پروتکل، مثلاً «A16,1».',
    params: [
      {
        key: 'text',
        label: 'Command text',
        labelFa: 'متن دستور',
        type: 'string',
        maxLength: 1000,
        allowComma: true,
        required: true,
        hint: 'e.g. A19,5',
        hintFa: 'مثلاً A19,5',
      },
    ],
    expectResponse: true,
    supportsReadback: false,
  },
];

/** Catalog lookup by command code. */
export function getCommandDef(code: string): CommandDef | undefined {
  return MEITRACK_COMMAND_CATALOG.find((c) => c.code === code.toUpperCase());
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validation failure (mapped to HTTP 422 by the controller). */
export class CommandValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CommandValidationError';
  }
}

/**
 * Validate + normalize caller-supplied params against a catalog definition.
 * Returns only the provided keys (normalized: numbers as numbers, enums/strings
 * as trimmed strings). Throws CommandValidationError on any violation.
 */
export function validateParams(def: CommandDef, raw: Params): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const defs = def.params;
  const unknown = Object.keys(raw).filter((k) => !defs.some((d) => d.key === k));
  if (unknown.length > 0) {
    throw new CommandValidationError(
      `Unknown parameter(s) for ${def.code}: ${unknown.join(', ')}.`,
    );
  }

  for (const p of defs) {
    const provided =
      raw[p.key] !== undefined && raw[p.key] !== null && String(raw[p.key]).trim() !== '';
    if (!provided) {
      if (p.required) {
        throw new CommandValidationError(`Parameter '${p.key}' is required for ${def.code}.`);
      }
      continue;
    }
    const value = String(raw[p.key]).trim();
    switch (p.type) {
      case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          throw new CommandValidationError(`Parameter '${p.key}' must be a number.`);
        }
        if (p.integer !== false && !Number.isInteger(n)) {
          throw new CommandValidationError(`Parameter '${p.key}' must be an integer.`);
        }
        if (p.min !== undefined && n < p.min) {
          throw new CommandValidationError(`Parameter '${p.key}' must be ≥ ${p.min}.`);
        }
        if (p.max !== undefined && n > p.max) {
          throw new CommandValidationError(`Parameter '${p.key}' must be ≤ ${p.max}.`);
        }
        out[p.key] = n;
        break;
      }
      case 'enum': {
        if (p.options && p.options.length > 0 && !p.options.some((o) => o.value === value)) {
          throw new CommandValidationError(
            `Parameter '${p.key}' must be one of: ${p.options.map((o) => o.value).join(', ')}.`,
          );
        }
        out[p.key] = value;
        break;
      }
      default: {
        // string
        if (/,/.test(value) && !p.allowComma) {
          throw new CommandValidationError(`Parameter '${p.key}' must not contain commas.`);
        }
        if (/[\r\n]/.test(value)) {
          throw new CommandValidationError(`Parameter '${p.key}' must not contain line breaks.`);
        }
        if (p.maxLength !== undefined && value.length > p.maxLength) {
          throw new CommandValidationError(
            `Parameter '${p.key}' must be at most ${p.maxLength} characters.`,
          );
        }
        out[p.key] = value;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Payload builders — validated params → wire payload
// ---------------------------------------------------------------------------

const MAX_COMMAND_BYTES = 1024; // protocol §1.1 — command content ≤ 1024 bytes

/**
 * Build the wire payload for a catalog command from validated params.
 * `text` payloads are emitted verbatim after `<imei>,`; `hex` payloads carry
 * binary struct bytes (media commands) which the gateway frames byte-wise.
 */
export function buildPayload(def: CommandDef, p: Record<string, string | number>): CommandPayload {
  const payload = build(def, p);
  const bytes = payload.kind === 'text' ? payload.text.length : payload.hex.length / 2;
  if (bytes > MAX_COMMAND_BYTES) {
    throw new CommandValidationError(
      `Command payload exceeds the ${MAX_COMMAND_BYTES}-byte protocol limit.`,
    );
  }
  return payload;
}

function build(def: CommandDef, p: Record<string, string | number>): CommandPayload {
  const code = def.code;
  const raw = p as Params;
  const anyParam = Object.keys(p).length > 0;
  const text = (t: string): CommandPayload => ({ kind: 'text', text: t });

  switch (code) {
    // --- tracking ----------------------------------------------------------
    case 'A10':
      return text('A10');
    case 'A11':
      if (!anyParam) return text('A11');
      return text(`A11,${num(raw, 'minutes')}`);
    case 'A12':
      if (!anyParam) return text('A12');
      return text(`A12,${num(raw, 'interval')}`);
    case 'A13':
      if (!anyParam) return text('A13');
      return text(`A13,${num(raw, 'angle')}`);
    case 'A14':
      if (!anyParam) return text('A14');
      return text(`A14,${num(raw, 'distance')}`);
    case 'A15':
      if (!anyParam) return text('A15');
      return text(`A15,${num(raw, 'interval')}`);
    case 'A16':
      if (!anyParam) return text('A16');
      return text(`A16,${str(raw, 'status')}`);
    case 'A17':
      if (!anyParam) return text('A17');
      return text(`A17,${str(raw, 'enabled')}`);

    // --- media: on-demand photo capture ------------------------------------
    case 'D03':
      return text(`D03,${num(raw, 'camera')},${str(raw, 'imagename')}`);
    case 'D01':
      return text(`D01,${num(raw, 'startIndex') ?? 0}`);
    case 'D00':
      return text(`D00,${str(raw, 'filename')},${num(raw, 'startPacket') ?? 0}`);

    // --- network -----------------------------------------------------------
    case 'A21':
    case 'A25': {
      if (!anyParam) return text(code);
      return text(
        `${code},${str(raw, 'mode')},${str(raw, 'host')},${num(raw, 'port')}` +
          `,${str(raw, 'apn') ?? ''},${str(raw, 'apnUser') ?? ''},${str(raw, 'apnPassword') ?? ''}`,
      );
    }
    case 'A23':
      if (!anyParam) return text('A23');
      return text(`A23,${str(raw, 'host')},${num(raw, 'port')}`);
    case 'ABB': {
      if (!anyParam) return text('ABB');
      return text(
        `ABB,${str(raw, 'enabled')},${str(raw, 'ssid') ?? ''},${str(raw, 'password') ?? ''}`,
      );
    }
    case 'AA3':
      return text('AA3');

    // --- phone / sms -------------------------------------------------------
    case 'A70':
      return text('A70');
    case 'A71':
      return text(
        `A71,${str(raw, 'phone1') ?? ''},${str(raw, 'phone2') ?? ''},${str(raw, 'phone3') ?? ''}`,
      );
    case 'A72':
      return text(`A72,${str(raw, 'phone1') ?? ''},${str(raw, 'phone2') ?? ''}`);
    case 'C02':
      return text(`C02,${str(raw, 'mode')},${str(raw, 'phone')},${str(raw, 'content')}`);
    case 'B91':
      return text(`B91,${num(raw, 'eventCode')},${str(raw, 'header')}`);
    case 'B99': {
      const target = str(raw, 'target') ?? '2';
      const phone = str(raw, 'phone');
      const op = str(raw, 'operation') ?? '0';
      const codes = list(str(raw, 'eventCodes'));
      const head =
        target === '0' || target === '1' ? `${target},${phone ?? ''},${op}` : `${target},${op}`;
      return text(codes.length > 0 ? `B99,${head},${codes.join(',')}` : `B99,${head}`);
    }

    // --- alerts ------------------------------------------------------------
    case 'B07':
      return text(`B07,${num(raw, 'speed')}`);
    case 'B08':
      return text(`B08,${num(raw, 'seconds')}`);
    case 'B10':
      return text(`B10,${num(raw, 'seconds')},${num(raw, 'idleMinutes') ?? 2}`);
    case 'C47':
      if (!anyParam) return text('C47');
      return text(
        `C47,${str(raw, 'sensorType') ?? 0},${num(raw, 'upperLimit') ?? ''},${num(raw, 'lowerLimit') ?? ''}`,
      );
    case 'C48':
      return text('C48');
    case 'C49':
      return text(`C49,${num(raw, 'checkMinutes')},${num(raw, 'decreasePercent')}`);
    case 'D79':
      return text(`D79,${num(raw, 'acceleration')},${num(raw, 'braking')}`);
    case 'C90': {
      if (!anyParam) return text('C90');
      return text(
        `C90,${str(raw, 'volume')},${str(raw, 'absence') ?? 0},${str(raw, 'distraction') ?? 0}` +
          `,${str(raw, 'smoking') ?? 0},${str(raw, 'phoneCall') ?? 0}`,
      );
    }

    // --- geofence ----------------------------------------------------------
    case 'B05':
      return text(
        `B05,${num(raw, 'fenceNumber')},${coord(num(raw, 'latitude') ?? 0)}` +
          `,${coord(num(raw, 'longitude') ?? 0)},${num(raw, 'radius')}` +
          `,${str(raw, 'enterAlert')},${str(raw, 'exitAlert')}`,
      );
    case 'B06':
      return text(`B06,${num(raw, 'fenceNumber')}`);
    case 'B11': {
      const fence = num(raw, 'fenceNumber') ?? 0;
      const pointsStr = str(raw, 'points');
      if (!pointsStr) return text(`B11,${fence}`); // number only → delete
      const tokens = pointsStr.split(/[,;\s]+/).map(Number);
      if (tokens.length < 6 || tokens.length % 2 !== 0) {
        throw new CommandValidationError('B11 needs at least 3 lat,lng pairs.');
      }
      for (const t of tokens) {
        if (!Number.isFinite(t)) {
          throw new CommandValidationError('B11 points must be numeric lat,lng pairs.');
        }
      }
      const flat = tokens.map((t) => coord(t)).join(',');
      return text(
        `B11,${fence},${flat},${str(raw, 'enterAlert') ?? 1},${str(raw, 'exitAlert') ?? 1}`,
      );
    }

    // --- device ------------------------------------------------------------
    case 'A73':
      return text(`A73,${str(raw, 'level')}`);
    case 'B22':
      return text(`B22,${num(raw, 'mode')}`);
    case 'B26': {
      const parts: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const v = num(raw, `port${i}`);
        if (v !== undefined) parts.push(`${i}:${v}`);
      }
      if (parts.length === 0) return text('B26');
      return text(`B26,${parts.join(',')}`);
    }
    case 'B31':
      return text(`B31,${str(raw, 'state')}`);
    case 'B34':
      return text(`B34,${num(raw, 'interval')}`);
    case 'B35':
      return text(`B35,${num(raw, 'minutes')}`);
    case 'B36':
      return text(`B36,${num(raw, 'minutes')}`);
    case 'D73':
      return text(`D73,${num(raw, 'gprsPercent')},${num(raw, 'logPercent')}`);
    case 'F08': {
      const runtime = num(raw, 'runtime');
      const mileage = num(raw, 'mileage');
      if (runtime === undefined && mileage === undefined) {
        throw new CommandValidationError('F08 needs at least one of runtime / mileage.');
      }
      return text(`F08,${runtime ?? ''},${mileage ?? ''}`);
    }
    case 'D65':
    case 'D66': {
      const points = list(str(raw, 'points')).map(Number);
      if (
        points.length === 0 ||
        points.length > 8 ||
        points.some((n) => !Number.isFinite(n) || n < 0)
      ) {
        throw new CommandValidationError(`${code} needs 1–8 non-negative numeric points.`);
      }
      while (points.length < 8) points.push(0);
      return text(`${code},${points.join(',')}`);
    }

    // --- outputs -----------------------------------------------------------
    case 'C01': {
      const outs = [1, 2, 3, 4, 5].map((i) => str(raw, `out${i}`) ?? '2').join('');
      return text(`C01,${num(raw, 'speed')},${outs}`);
    }
    case 'D72':
      return text(
        `D72,${str(raw, 'port')},${num(raw, 'time')},${str(raw, 'level')}` +
          `,${num(raw, 'dutyCycle') ?? 0},${num(raw, 'pwmPeriod') ?? 10000}`,
      );

    // --- rfid --------------------------------------------------------------
    case 'D10':
    case 'D14': {
      const ids = list(str(raw, 'ids')).map(Number);
      if (ids.length === 0 || ids.some((n) => !Number.isFinite(n))) {
        throw new CommandValidationError(`${code} needs numeric id list.`);
      }
      return text(`${code},${ids.join(',')}`);
    }
    case 'D11':
    case 'D15':
      return text(`${code},${num(raw, 'start')},${num(raw, 'count')}`);
    case 'D12':
      return text(`D12,${num(raw, 'id')}`);
    case 'D13':
      return text(`D13,${num(raw, 'packetStart')}`);
    case 'D16':
      return text('D16');

    // --- temperature -------------------------------------------------------
    case 'C40':
    case 'C43':
      return text(`${code},${str(raw, 'data')}`);
    case 'C41': {
      const numbers = list(str(raw, 'numbers'));
      if (numbers.length === 0) return text('C41');
      return text(`C41,${numbers.join(',')}`);
    }
    case 'C42':
    case 'C44':
    case 'C46':
      return text(code);

    // --- tpms --------------------------------------------------------------
    case 'DA0':
    case 'DA1':
      return text(code);
    case 'DA2':
      return text(`DA2,${str(raw, 'location')}`);
    case 'DA3':
      return text(`DA3,${list(str(raw, 'locations')).join(',')}`);
    case 'DA4':
      return text(`DA4,${str(raw, 'data')}`);
    case 'DA5':
      return text(`DA5,${str(raw, 'data')}`);

    // --- media (binary structs) -------------------------------------------
    case 'A9A': {
      const struct = [
        ...lpAscii(str(raw, 'server') ?? ''),
        ...u16be(num(raw, 'tcpPort') ?? 0),
        ...u16be(num(raw, 'udpPort') ?? 0),
        ...byte(num(raw, 'channel') ?? 0),
        ...byte(Number(str(raw, 'dataType'))),
        ...byte(Number(str(raw, 'streamType'))),
      ];
      return hexBody('A9A', struct);
    }
    case 'A9B':
    case 'AB3': {
      const struct = [
        ...byte(num(raw, 'channel') ?? 0),
        ...byte(Number(str(raw, 'control'))),
        ...byte(Number(str(raw, 'closeType') ?? '0')),
        ...byte(Number(str(raw, 'switchType') ?? '0')),
      ];
      return hexBody(code, struct);
    }
    case 'A9C': {
      const codes = list(str(raw, 'alarmCodes')).map((c) => Number.parseInt(c, 10));
      const struct = [
        ...byte(num(raw, 'channel') ?? 0),
        ...bcdTime(str(raw, 'startTime')),
        ...bcdTime(str(raw, 'endTime')),
        ...new Array<number>(8).fill(0), // alarm_flag reserved
        ...byte(Number(str(raw, 'avType'))),
        ...byte(Number(str(raw, 'streamType'))),
        ...byte(Number(str(raw, 'capType'))),
        ...u16le(codes.length),
        ...codes.flatMap((c) => u16le(c)),
      ];
      return hexBody(code, struct);
    }
    case 'AB8': {
      const codes = list(str(raw, 'alarmCodes')).map((c) => Number.parseInt(c, 10));
      const struct = [
        ...byte(num(raw, 'channel') ?? 0),
        ...bcdTime(str(raw, 'startTime')),
        ...bcdTime(str(raw, 'endTime')),
        ...new Array<number>(8).fill(0),
        ...byte(Number(str(raw, 'avType'))),
        ...byte(Number(str(raw, 'streamType'))),
        ...byte(Number(str(raw, 'capType'))),
        ...u16le(codes.length),
        ...codes.flatMap((c) => u16le(c)),
        ...u16le(0), // Appoint_PACK N=0 → all packets (§3.31)
      ];
      return hexBody('AB8', struct);
    }
    case 'A9D': {
      const struct = [
        ...lpAscii(str(raw, 'server') ?? ''),
        ...u16be(num(raw, 'tcpPort') ?? 0),
        ...u16be(num(raw, 'udpPort') ?? 0),
        ...byte(num(raw, 'channel') ?? 0),
        ...byte(Number(str(raw, 'avType'))),
        ...byte(Number(str(raw, 'streamType'))),
        ...byte(Number(str(raw, 'capType'))),
        ...byte(Number(str(raw, 'reviewStyle') ?? 0)),
        ...byte(0), // viewRank — reserved
        ...bcdTime(str(raw, 'startTime')),
        ...bcdTime(str(raw, 'endTime')),
      ];
      return hexBody('A9D', struct);
    }
    case 'A9E':
    case 'AB5': {
      const struct = [
        ...byte(num(raw, 'channel') ?? 0),
        ...byte(Number(str(raw, 'control'))),
        ...byte(0), // viewRank
        ...bcdTime(str(raw, 'dragPoint')),
      ];
      return hexBody(code, struct);
    }
    case 'A9F': {
      const struct = [
        ...lpAscii(str(raw, 'server') ?? ''),
        ...u16be(num(raw, 'port') ?? 0),
        ...lpAscii(str(raw, 'username') ?? ''),
        ...lpAscii(str(raw, 'password') ?? ''),
        ...lpAscii(str(raw, 'path') ?? ''),
        ...byte(num(raw, 'channel') ?? 0),
        ...bcdTime(str(raw, 'startTime')),
        ...bcdTime(str(raw, 'endTime')),
        ...new Array<number>(8).fill(0xff), // alarm_flag — FF fill (§4.6)
        ...byte(Number(str(raw, 'avType') ?? '0')),
        ...byte(Number(str(raw, 'streamType') ?? '0')),
        ...byte(Number(str(raw, 'capType') ?? '0')),
        ...byte(Number(str(raw, 'execute'))),
      ];
      return hexBody('A9F', struct);
    }
    case 'AA0': {
      const name = str(raw, 'fileName') ?? '';
      const struct = [...byte(Number(str(raw, 'flag'))), ...ascii(name)];
      return hexBody('AA0', struct);
    }
    case 'AA1':
      return text('AA1');
    case 'AA4': {
      const ym = bcdYearMonth(str(raw, 'yearMonth'));
      if (ym.length === 0) return text('AA4');
      return hexBody('AA4', ym);
    }
    case 'AB2': {
      const dataType = str(raw, 'dataType') ?? '';
      const struct = [
        ...lpAscii(str(raw, 'uploadUrl') ?? ''),
        ...byte(num(raw, 'channel') ?? 0),
        ...byte(Number(dataType)),
        ...byte(Number(str(raw, 'streamType'))),
        ...(dataType === '2' ? lpAscii(str(raw, 'downloadUrl') ?? '') : []),
      ];
      return hexBody('AB2', struct);
    }
    case 'AB4': {
      const struct = [
        ...lpAscii(str(raw, 'url') ?? ''),
        ...byte(num(raw, 'channel') ?? 0),
        ...byte(Number(str(raw, 'avType'))),
        ...byte(Number(str(raw, 'streamType'))),
        ...byte(Number(str(raw, 'capType'))),
        ...byte(0), // reviewStyle normal
        ...byte(0), // viewRank
        ...bcdTime(str(raw, 'startTime')),
        ...bcdTime(str(raw, 'endTime')),
      ];
      return hexBody('AB4', struct);
    }
    case 'BB8':
      if (!anyParam) return text('BB8');
      return text(`BB8,${num(raw, 'volume')}`);
    case 'B64': {
      if (!anyParam) return text('B64');
      return text(
        `B64,${str(raw, 'mode')},${str(raw, 'username') ?? ''},${str(raw, 'password') ?? ''}` +
          `,${str(raw, 'host') ?? ''},${str(raw, 'port') ?? ''},${str(raw, 'path') ?? ''}`,
      );
    }
    case 'CB8': {
      if (!anyParam) return text('CB8');
      const entries = str(raw, 'entries');
      if (!entries) return text(`CB8,${str(raw, 'operation')}`);
      // entries: "code,channel,seconds,priority;…" → "code,channel,seconds,priority;…"
      const groups = entries
        .split(/[;\n]+/)
        .map((g) => g.trim())
        .filter(Boolean);
      for (const g of groups) {
        const parts = g.split(',').map((s) => s.trim());
        if (parts.length !== 4 || parts.some((s) => !/^\d+$/.test(s))) {
          throw new CommandValidationError(
            'CB8 entries must be event,channel,seconds,priority groups separated by ";".',
          );
        }
      }
      return text(`CB8,${str(raw, 'operation')};${groups.join(';')}`);
    }

    // --- system ------------------------------------------------------------
    case 'C03':
      return text(`C03,${str(raw, 'mode')}`);
    case 'C61':
      return text(`C61,${timestamp14()},0,${str(raw, 'deviceNo') ?? '02'},${str(raw, 'data')}`);
    case 'CFF':
      return text(`CFF,${str(raw, 'count')}`);
    case 'E91':
      return text('E91');
    case 'DA6':
      return text('DA6');
    case 'DB4':
      return text('DB4');
    case 'F00':
      return text(`F00,${str(raw, 'gsm')},${str(raw, 'gps')}`);
    case 'F01':
      return text('F01');
    case 'F02':
      return text('F02');
    case 'F09':
      return text(`F09,${str(raw, 'which')}`);
    case 'F11':
      return text('F11');

    // --- custom ------------------------------------------------------------
    case 'RAW': {
      const t = str(raw, 'text') ?? '';
      if (!/^[A-F][0-9A-F]{2}($|,)/.test(t)) {
        throw new CommandValidationError(
          'RAW command must start with a command code like A10 or B05.',
        );
      }
      return text(t);
    }

    default:
      throw new CommandValidationError(`No payload builder for command ${code}.`);
  }
}

/** Server date & time for C61 — 14 digits YYYYMMDDHHMMSS (§3.61). */
function timestamp14(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}
