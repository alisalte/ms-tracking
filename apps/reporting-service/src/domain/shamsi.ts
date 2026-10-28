/**
 * Solar Hijri (Shamsi) date and local clock of an instant, for CSV exports.
 * Latin digits on purpose: spreadsheets sort and parse them, and the file is
 * read by tools as well as by people.
 */

export interface ShamsiStamp {
  /** `1405/06/15` */
  readonly date: string;
  /** `14:05:30` (24-hour) */
  readonly time: string;
}

export function shamsiStamp(at: Date, timeZone: string): ShamsiStamp {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${pick('year')}/${pick('month')}/${pick('day')}`,
    time: `${pick('hour')}:${pick('minute')}:${pick('second')}`,
  };
}

/** Both cells of a nullable instant; empty cells when it is missing or invalid. */
export function shamsiCells(value: unknown, timeZone: string): [string, string] {
  if (value === null || value === undefined || value === '') return ['', ''];
  const at = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(at.getTime())) return ['', ''];
  const stamp = shamsiStamp(at, timeZone);
  return [stamp.date, stamp.time];
}
