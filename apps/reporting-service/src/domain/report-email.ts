/**
 * Persian subject/body for a scheduled report email. Plain text plus an RTL
 * HTML part so mail clients lay the Persian text out right-to-left.
 */
import type { SchedulableReport, SchedulePreset } from './report-schedule.js';
import { shamsiStamp } from './shamsi.js';

const REPORT_LABELS: Readonly<Record<SchedulableReport, string>> = {
  trips: 'سفرها',
  'vehicle-utilization': 'بهره‌وری خودروها',
  alarms: 'هشدارها',
  'haul-cycles': 'سرویس‌های حمل',
  'haul-shifts': 'کارکرد رانندگان و تراک‌ها (شیفت روز و شب)',
};

const PRESET_LABELS: Readonly<Record<SchedulePreset, string>> = {
  today: 'امروز',
  yesterday: 'دیروز',
  '7d': '۷ روز گذشته',
  '30d': '۳۰ روز گذشته',
};

export interface ReportEmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function buildReportEmail(input: {
  name: string;
  reportType: SchedulableReport;
  preset: SchedulePreset;
  rows: number;
  generatedAt: Date;
  timeZone: string;
}): ReportEmailContent {
  const stamp = shamsiStamp(input.generatedAt, input.timeZone);
  const lines: Array<[string, string]> = [
    ['نوع گزارش', REPORT_LABELS[input.reportType] ?? input.reportType],
    ['بازه', PRESET_LABELS[input.preset] ?? input.preset],
    ['تعداد ردیف', input.rows.toLocaleString('fa-IR')],
    ['زمان تهیه', `${stamp.date} ساعت ${stamp.time.slice(0, 5)}`],
  ];
  const intro = `گزارش زمان‌بندی‌شدهٔ «${input.name}» آماده است.`;
  const outro = 'فایل اکسل گزارش پیوست این ایمیل است.';
  const text = [intro, '', ...lines.map(([k, v]) => `${k}: ${v}`), '', outro].join('\n');
  const html = [
    '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;text-align:right">',
    `<p>${escapeHtml(intro)}</p>`,
    '<table style="border-collapse:collapse">',
    ...lines.map(
      ([k, v]) =>
        `<tr><td style="padding:2px 0 2px 16px;color:#555">${escapeHtml(k)}</td><td style="padding:2px 0"><b>${escapeHtml(v)}</b></td></tr>`,
    ),
    '</table>',
    `<p>${escapeHtml(outro)}</p>`,
    '</div>',
  ].join('\n');
  return { subject: `[FleetVision] گزارش ${input.name}`, text, html };
}
