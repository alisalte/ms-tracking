/**
 * Tabular spreadsheet helpers for asset import.
 *
 * Reads CSV, SpreadsheetML (.xls XML), and Office Open XML (.xlsx).
 * Writes a real .xlsx (stored ZIP, inline strings) so Excel opens the template
 * without a format-mismatch warning. No third-party spreadsheet library.
 */

export class SpreadsheetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpreadsheetParseError';
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Uncompressed ZIP (method 0) — enough for Excel to open a generated workbook. */
export function zipStore(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof body === 'string' ? encoder.encode(body) : body;
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const localBlob = concat(locals);
  const centralBlob = concat(centrals);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files ? Object.keys(files).length : 0),
    u16(Object.keys(files).length),
    u32(centralBlob.length),
    u32(localBlob.length),
    u16(0),
  ]);
  return concat([localBlob, centralBlob, eocd]);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new SpreadsheetParseError('Cannot decompress this Excel file in this browser.');
}

async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  let i = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (i + 4 <= buf.length) {
    const sig = view.getUint32(i, true);
    if (sig === 0x02014b50 || sig === 0x06054b50) break; // central dir / EOCD
    if (sig !== 0x04034b50) {
      throw new SpreadsheetParseError('The Excel file is not a valid .xlsx archive.');
    }
    const method = view.getUint16(i + 8, true);
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const compSize = view.getUint32(i + 18, true);
    const flags = view.getUint16(i + 6, true);
    const nameStart = i + 30;
    const name = new TextDecoder().decode(buf.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    if (flags & 0x8) {
      // Data descriptor after the payload — walk until PK\x07\x08 or next local.
      throw new SpreadsheetParseError(
        'This Excel file uses an unsupported ZIP layout. Save as .xlsx (Office Open XML) or CSV.',
      );
    }
    const payload = buf.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) data = payload;
    else if (method === 8) data = await inflateRaw(payload);
    else throw new SpreadsheetParseError('Unsupported Excel compression.');
    out.set(name.replace(/\\/g, '/'), data);
    i = dataStart + compSize;
  }
  return out;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  const letters = m?.[1]?.toUpperCase();
  const rowPart = m?.[2];
  if (!letters || !rowPart) return null;
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) col = col * 26 + (letters.charCodeAt(i) - 64);
  return { col: col - 1, row: Number(rowPart) - 1 };
}

function textContent(el: Element | null): string {
  if (!el) return '';
  return (el.textContent ?? '').replace(/\r\n/g, '\n').trim();
}

function parseSharedStrings(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const sis = [...doc.getElementsByTagName('si')];
  return sis.map((si) => {
    const texts = [...si.getElementsByTagName('t')];
    return texts.map((t) => t.textContent ?? '').join('');
  });
}

function parseSheetXml(xml: string, shared: string[]): string[][] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const cells = [...doc.getElementsByTagName('c')];
  const grid = new Map<string, string>();
  let maxRow = -1;
  let maxCol = -1;
  for (const cell of cells) {
    const ref = cell.getAttribute('r');
    if (!ref) continue;
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const type = cell.getAttribute('t');
    let value = '';
    if (type === 's') {
      const idx = Number(textContent(cell.getElementsByTagName('v')[0] ?? null));
      value = Number.isFinite(idx) ? (shared[idx] ?? '') : '';
    } else if (type === 'inlineStr') {
      value = textContent(cell.getElementsByTagName('t')[0] ?? null);
    } else {
      value = textContent(cell.getElementsByTagName('v')[0] ?? cell);
    }
    grid.set(`${pos.row}:${pos.col}`, value);
    if (pos.row > maxRow) maxRow = pos.row;
    if (pos.col > maxCol) maxCol = pos.col;
  }
  const rows: string[][] = [];
  for (let r = 0; r <= maxRow; r += 1) {
    const row: string[] = [];
    for (let c = 0; c <= maxCol; c += 1) row.push(grid.get(`${r}:${c}`) ?? '');
    rows.push(row);
  }
  return rows;
}

function parseSpreadsheetMl(xml: string): string[][] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const table =
    doc.getElementsByTagName('Table')[0] ??
    doc.getElementsByTagNameNS('urn:schemas-microsoft-com:office:spreadsheet', 'Table')[0];
  if (!table) throw new SpreadsheetParseError('The Excel XML file has no table.');
  const ns = 'urn:schemas-microsoft-com:office:spreadsheet';
  const xmlRows = [...table.getElementsByTagName('Row')];
  if (xmlRows.length === 0) {
    xmlRows.push(...table.getElementsByTagNameNS(ns, 'Row'));
  }
  const rows: string[][] = [];
  for (const xmlRow of xmlRows) {
    const cells = [...xmlRow.getElementsByTagName('Cell')];
    if (cells.length === 0) cells.push(...xmlRow.getElementsByTagNameNS(ns, 'Cell'));
    const row: string[] = [];
    let col = 0;
    for (const cell of cells) {
      const idx = cell.getAttribute('ss:Index') ?? cell.getAttribute('Index');
      if (idx) {
        const n = Number(idx);
        if (Number.isFinite(n) && n > 0) {
          while (col < n - 1) {
            row.push('');
            col += 1;
          }
        }
      }
      const data =
        cell.getElementsByTagName('Data')[0] ?? cell.getElementsByTagNameNS(ns, 'Data')[0];
      row.push(textContent(data));
      col += 1;
    }
    rows.push(row);
  }
  return rows;
}

/** RFC 4180 CSV with comma or semicolon (Excel FA locale). */
export function parseCsv(text: string): string[][] {
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim =
    (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || (ch === '\r' && src[i + 1] === '\n') || ch === '\r') {
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function serializeCsv(rows: string[][]): string {
  const esc = (c: string) => {
    if (/[",\n\r;]/.test(c)) return `"${c.replace(/"/g, '""')}"`;
    return c;
  };
  return `\uFEFF${rows.map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`;
}

function sheetXml(rows: string[][]): string {
  const rowXml = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<sheetData>${rowXml}</sheetData></worksheet>`,
  ].join('');
}

/** Build a real .xlsx workbook (first sheet) from a table of strings. */
export function buildXlsx(sheetName: string, rows: string[][]): Uint8Array {
  const safeName = sheetName.replace(/[\\/?*[\]]/g, ' ').slice(0, 31) || 'Sheet1';
  return zipStore({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '</Types>',
    ].join(''),
    '_rels/.rels': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
      '</Relationships>',
    ].join(''),
    'xl/workbook.xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      `<sheets><sheet name="${xmlEscape(safeName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ].join(''),
    'xl/_rels/workbook.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
      '</Relationships>',
    ].join(''),
    'xl/worksheets/sheet1.xml': sheetXml(rows),
  });
}

async function parseXlsx(buf: Uint8Array): Promise<string[][]> {
  const files = await unzip(buf);
  const sheetPath =
    [...files.keys()].find((k) => /^xl\/worksheets\/sheet1\.xml$/i.test(k)) ??
    [...files.keys()].find((k) => /xl\/worksheets\/sheet\d+\.xml$/i.test(k));
  if (!sheetPath) throw new SpreadsheetParseError('The Excel file has no worksheet.');
  const sheet = files.get(sheetPath);
  if (!sheet) throw new SpreadsheetParseError('The Excel file has no worksheet.');
  const ssPath = [...files.keys()].find((k) => /xl\/sharedStrings\.xml$/i.test(k));
  const shared =
    ssPath && files.get(ssPath)
      ? parseSharedStrings(new TextDecoder().decode(files.get(ssPath)))
      : [];
  return parseSheetXml(new TextDecoder().decode(sheet), shared);
}

function looksLikeXml(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('<?xml') || t.startsWith('<Workbook');
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  // jsdom's Blob/File historically lacked arrayBuffer(); FileReader is the fallback.
  if (typeof FileReader !== 'undefined') {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () =>
        reject(reader.error ?? new SpreadsheetParseError('Could not read the file.'));
      reader.readAsArrayBuffer(blob);
    });
  }
  throw new SpreadsheetParseError('Could not read the file.');
}

/**
 * Parse an uploaded spreadsheet into a string grid (first sheet).
 * Rejects legacy binary .xls with a clear message.
 */
export async function parseTabularFile(file: File | Blob, filename?: string): Promise<string[][]> {
  const name = (filename ?? (file instanceof File ? file.name : '')).toLowerCase();
  const buf = await blobToBytes(file);
  if (buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw new SpreadsheetParseError(
      'Legacy .xls (Excel 97-2003) is not supported. Save as .xlsx or CSV, or use the template.',
    );
  }
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    return parseXlsx(buf);
  }
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (looksLikeXml(text) || name.endsWith('.xml')) {
    return parseSpreadsheetMl(text);
  }
  return parseCsv(text);
}

/** Trim trailing empty rows / columns so preview stays tight. */
export function trimGrid(rows: string[][]): string[][] {
  const trimmed = rows.map((r) => {
    let end = r.length;
    while (end > 0 && (r[end - 1] ?? '').trim() === '') end -= 1;
    return r.slice(0, end).map((c) => c.trim());
  });
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]?.every((c) => c === '')) trimmed.pop();
  return trimmed;
}
