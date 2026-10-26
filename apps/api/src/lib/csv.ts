/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and newlines inside quotes,
 * CRLF or LF line endings, and a UTF-8 BOM from Excel exports. Returns rows of strings.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop rows that are entirely empty (blank lines, trailing newline).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Turns a parsed CSV into objects keyed by normalised header names (lower case, spaces → underscores). */
export function csvToRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCsv(text);
  const [head, ...body] = rows;
  if (!head) return { headers: [], records: [] };
  const headers = head.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const records = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, records };
}
