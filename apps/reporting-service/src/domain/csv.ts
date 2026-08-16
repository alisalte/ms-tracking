/**
 * CSV serialization (Sprint J §31/§32) — pure + unit-testable.
 *
 * - RFC-4180 quoting (values containing `,` `"` `\r` `\n` are double-quoted,
 *   embedded quotes doubled).
 * - **Formula-injection protection**: values beginning with `=`, `+`, `-`, `@`,
 *   tab, or CR are prefixed with `'` (Excel/Sheets neutralizer) — controlled
 *   per the brief's "safely escaped" requirement; numeric columns emitted from
 *   typed numbers never begin with those characters.
 * - UTF-8 BOM so Excel opens UTF-8 (fa labels) correctly.
 * - No internal IDs beyond what the report's own columns define; no
 *   tokens/secrets ever (values come from report rows only).
 */

export type CsvValue = string | number | boolean | null | undefined;

/** Escape one cell (formula-injection safe). */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'number') {
    s = Number.isFinite(value) ? String(value) : '';
  } else if (typeof value === 'boolean') {
    s = value ? 'true' : 'false';
  } else {
    s = value;
  }
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    s = `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

/** One CSV row (without line terminator). */
export function csvRow(cells: readonly CsvValue[]): string {
  return cells.map(csvCell).join(',');
}

/** Full document: BOM + header + rows + trailing newline. */
export function csvDocument(header: readonly string[], rows: readonly CsvValue[][]): string {
  const lines = [csvRow(header), ...rows.map((r) => csvRow(r))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
