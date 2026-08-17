/**
 * Device-command mock fixtures — a representative subset of the Meitrack MDVR
 * catalog (the real backend serves all ~74 commands) + a deterministic history
 * so the Command Center renders fully in mock mode (`?useMock=true`).
 */
import type {
  CommandCategory,
  CommandDef,
  CommandStatus,
  DeviceCommandRecord,
} from '@/types/command.types';

const ON_OFF = [
  { value: '0', label: 'Off', labelFa: 'غیرفعال' },
  { value: '1', label: 'On', labelFa: 'فعال' },
];

export function mockCommandCatalog(): CommandDef[] {
  return [
    {
      code: 'A10',
      name: 'Real-Time Location Query',
      nameFa: 'کوئری موقعیت لحظه‌ای',
      category: 'tracking' as CommandCategory,
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
      category: 'tracking' as CommandCategory,
      description: 'Heartbeat packet interval; 0 disables.',
      descriptionFa: 'بازه پکت هارت‌بیت؛ صفر غیرفعال می‌کند.',
      params: [
        {
          key: 'minutes',
          label: 'Interval',
          labelFa: 'بازه',
          type: 'number' as const,
          min: 0,
          max: 65535,
          unit: 'min',
          required: true,
          defaultValue: 10,
        },
      ],
      expectResponse: false,
      supportsReadback: false,
    },
    {
      code: 'A12',
      name: 'Tracking by Time Interval',
      nameFa: 'ردیابی با بازه زمانی',
      category: 'tracking' as CommandCategory,
      description: 'Scheduled GPRS reporting; 0 disables.',
      descriptionFa: 'گزارش‌دهی زمان‌بندی‌شده؛ صفر غیرفعال.',
      params: [
        {
          key: 'interval',
          label: 'Interval',
          labelFa: 'بازه',
          type: 'number' as const,
          min: 0,
          max: 65535,
          unit: '×10s',
          required: true,
          defaultValue: 6,
        },
      ],
      expectResponse: false,
      supportsReadback: false,
    },
    {
      code: 'B05',
      name: 'Circular Geo-Fence',
      nameFa: 'حصار جغرافیایی دایره‌ای',
      category: 'geofence' as CommandCategory,
      description: 'Center + radius fence with enter/exit alerts.',
      descriptionFa: 'حصار با مرکز و شعاع + هشدار ورود/خروج.',
      params: [
        {
          key: 'fenceNumber',
          label: 'Fence number',
          labelFa: 'شماره حصار',
          type: 'number' as const,
          min: 1,
          max: 8,
          required: true,
          defaultValue: 1,
        },
        {
          key: 'latitude',
          label: 'Latitude',
          labelFa: 'عرض جغرافیایی',
          type: 'number' as const,
          min: -90,
          max: 90,
          integer: false,
          required: true,
        },
        {
          key: 'longitude',
          label: 'Longitude',
          labelFa: 'طول جغرافیایی',
          type: 'number' as const,
          min: -180,
          max: 180,
          integer: false,
          required: true,
        },
        {
          key: 'radius',
          label: 'Radius',
          labelFa: 'شعاع',
          type: 'number' as const,
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
          type: 'enum' as const,
          options: ON_OFF,
          required: true,
          defaultValue: '0',
        },
        {
          key: 'exitAlert',
          label: 'Exit alert',
          labelFa: 'هشدار خروج',
          type: 'enum' as const,
          options: ON_OFF,
          required: true,
          defaultValue: '1',
        },
      ],
      expectResponse: false,
      supportsReadback: false,
    },
    {
      code: 'C01',
      name: 'Output Control',
      nameFa: 'کنترل خروجی‌ها',
      category: 'outputs' as CommandCategory,
      description: 'Set output ports 1–5 below a speed limit.',
      descriptionFa: 'تنظیم خروجی‌های ۱ تا ۵ زیر سرعت مشخص.',
      params: [
        {
          key: 'speed',
          label: 'Speed limit',
          labelFa: 'حد سرعت',
          type: 'number' as const,
          min: 0,
          max: 255,
          unit: 'km/h',
          required: true,
          defaultValue: 0,
        },
        {
          key: 'out1',
          label: 'Output 1',
          labelFa: 'خروجی ۱',
          type: 'enum' as const,
          options: [
            { value: '0', label: 'Close', labelFa: 'قطع' },
            { value: '1', label: 'Open', labelFa: 'وصل' },
            { value: '2', label: 'Keep', labelFa: 'حفظ' },
          ],
          required: true,
          defaultValue: '2',
        },
      ],
      expectResponse: false,
      supportsReadback: false,
    },
    {
      code: 'E91',
      name: 'Firmware Version & SN',
      nameFa: 'نسخه فریم‌ور و SN',
      category: 'system' as CommandCategory,
      description: 'Read the device firmware version and serial number.',
      descriptionFa: 'خواندن نسخه فریم‌ور و شماره سریال دستگاه.',
      params: [],
      expectResponse: true,
      supportsReadback: true,
    },
    {
      code: 'F11',
      name: 'Restore Initial Settings',
      nameFa: 'بازگردانی تنظیمات کارخانه',
      category: 'system' as CommandCategory,
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
      category: 'custom' as CommandCategory,
      description: 'Send any raw protocol command body, e.g. "A16,1".',
      descriptionFa: 'ارسال بدینه خام پروتکل، مثلاً «A16,1».',
      params: [
        {
          key: 'text',
          label: 'Command text',
          labelFa: 'متن دستور',
          type: 'string' as const,
          maxLength: 1000,
          required: true,
          hint: 'e.g. A19,5',
          hintFa: 'مثلاً A19,5',
        },
      ],
      expectResponse: true,
      supportsReadback: false,
    },
  ];
}

const MOCK_STATUSES: CommandStatus[] = ['ACKED', 'ACKED', 'SENT', 'QUEUED', 'FAILED', 'EXPIRED'];
const MOCK_CODES = ['A12', 'A11', 'B07', 'A10', 'C01', 'E91'];

export function mockCommandHistory(
  deviceId: string | null,
  status?: CommandStatus,
): DeviceCommandRecord[] {
  if (!deviceId) return [];
  const now = Date.now();
  const rows: DeviceCommandRecord[] = MOCK_CODES.map((code, i) => {
    const s = MOCK_STATUSES[i] ?? 'ACKED';
    const issuedAt = new Date(now - (i + 1) * 7 * 60_000);
    return {
      id: `mock-cmd-${i + 1}`,
      tenantId: 'mock-tenant',
      deviceId,
      commandCode: code,
      category: 'tracking',
      params: code === 'A12' ? { interval: 6 } : null,
      payloadText: code === 'A12' ? 'A12,6' : code,
      payloadHex: null,
      status: s,
      responseText: s === 'ACKED' ? `${code},OK` : null,
      error: s === 'FAILED' ? 'DEVICE_OFFLINE' : s === 'EXPIRED' ? 'TTL_EXPIRED' : null,
      issuedBy: 'mock-user',
      issuedAt: issuedAt.toISOString(),
      sentAt: s !== 'QUEUED' ? issuedAt.toISOString() : null,
      ackedAt:
        s === 'ACKED' || s === 'FAILED' ? new Date(issuedAt.getTime() + 4_000).toISOString() : null,
      expiresAt: new Date(issuedAt.getTime() + 120_000).toISOString(),
      version: 1,
      createdAt: issuedAt.toISOString(),
      updatedAt: issuedAt.toISOString(),
    };
  });
  return status ? rows.filter((r) => r.status === status) : rows;
}
