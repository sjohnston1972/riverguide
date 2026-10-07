// Minimal OpenDocument spreadsheet (.ods) reader: unzips content.xml and
// returns each sheet as rows of cells. Enough for simple tabular files such
// as SEPA's published freshet schedule; no formulas, styles or merged cells.
// Uses only web APIs (DecompressionStream), so it runs in Workers and Node.

export interface OdsCell {
  /** Displayed text, e.g. "Thursday, July 02, 2026". */
  text: string;
  /** Typed value when present: office:value / date-value / time-value / boolean-value. */
  value: string | null;
}

export type OdsSheets = Map<string, OdsCell[][]>;

export async function readOds(data: ArrayBuffer): Promise<OdsSheets> {
  const xml = await unzipEntry(data, 'content.xml');
  if (xml == null) throw new Error('Not an OpenDocument file: no content.xml');
  return parseOdsContent(xml);
}

/** Extracts one file from a zip archive as UTF-8 text (stored or deflated entries). */
export async function unzipEntry(data: ArrayBuffer, name: string): Promise<string | null> {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  // End of central directory record: scan back from the end (it may carry a comment).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive');
  const entries = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < entries; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const entryName = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;

    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    if (method === 0) return decoder.decode(raw);
    if (method !== 8) throw new Error(`Unsupported zip compression method ${method}`);
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m),
  );
}

function cellText(inner: string): string {
  return decodeXml(
    inner
      .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, c: string | undefined) => ' '.repeat(c ? Number(c) : 1))
      .replace(/<text:tab\s*\/>/g, '\t')
      .replace(/<text:line-break\s*\/>/g, '\n')
      .replace(/<\/text:p>\s*<text:p[^>]*>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  ).trim();
}

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

/** Parses content.xml into sheets. Trailing empty cells and empty rows are dropped. */
export function parseOdsContent(xml: string): OdsSheets {
  const sheets: OdsSheets = new Map();
  for (const t of xml.matchAll(/<table:table\s([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    const rows: OdsCell[][] = [];
    for (const r of t[2].matchAll(/<table:table-row(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const cells: OdsCell[] = [];
      for (const c of (r[2] ?? '').matchAll(/<table:(?:covered-)?table-cell(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
        const a = c[1] ?? '';
        const cell: OdsCell = {
          text: cellText(c[2] ?? ''),
          value: decodeOrNull(attr(a, 'office:value') ?? attr(a, 'office:date-value') ?? attr(a, 'office:time-value') ?? attr(a, 'office:boolean-value')),
        };
        // Files pad rows with one huge repeated empty cell; only expand repeats that hold something.
        const repeat = Number(attr(a, 'table:number-columns-repeated') ?? 1);
        const n = cell.text || cell.value ? Math.min(repeat, 1000) : Math.min(repeat, 64);
        for (let i = 0; i < n; i++) cells.push(cell);
      }
      while (cells.length && !cells[cells.length - 1].text && !cells[cells.length - 1].value) cells.pop();
      if (!cells.length) continue;
      const repeat = Math.min(Number(attr(r[1] ?? '', 'table:number-rows-repeated') ?? 1), 1000);
      for (let i = 0; i < repeat; i++) rows.push(cells);
    }
    sheets.set(decodeXml(attr(t[1], 'table:name') ?? `Sheet${sheets.size + 1}`), rows);
  }
  return sheets;
}

const decodeOrNull = (v: string | null) => (v == null ? null : decodeXml(v));
