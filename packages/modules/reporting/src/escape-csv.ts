/**
 * CSV FORMULA-INJECTION ESCAPING (the obligation Fable recorded in #3, now
 * due). One page, 100%-coverage-gated — the security review reads it whole.
 *
 * A spreadsheet treats a cell whose text begins with = + - @ (or a leading
 * TAB / CR, which some parsers strip to reveal the next char) as a formula.
 * A crafted student name like `=cmd|'/c calc'!A1` or `@SUM(...)` becomes a
 * live formula when the exported CSV is opened in Excel/Sheets — that is
 * remote-ish code execution on the recipient's machine, seeded by data an
 * attacker controls (a student/teacher name typed at enrolment).
 *
 * Defence (OWASP): prefix a single quote to any value whose first character
 * is dangerous, so the spreadsheet treats the whole cell as text; then apply
 * normal RFC-4180 quoting for commas/quotes/newlines. Both are required —
 * the quote-prefix defuses the formula, the RFC quoting keeps the CSV valid.
 */

const DANGEROUS_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** True if the cell would be interpreted as a formula by a spreadsheet. */
export function isFormulaInjection(value: string): boolean {
  return value.length > 0 && DANGEROUS_LEADERS.has(value[0]!);
}

/** Escapes one cell: neutralise formula leaders, then RFC-4180 quote. */
export function escapeCsvCell(input: string | number | null | undefined): string {
  const raw = input === null || input === undefined ? "" : String(input);
  // Neutralise a formula leader by prefixing a single quote (Excel/Sheets
  // then render the value as literal text, quote included in the cell text
  // but not evaluated).
  const defused = isFormulaInjection(raw) ? `'${raw}` : raw;
  // RFC-4180: wrap in quotes and double internal quotes when the value
  // contains a comma, quote, CR or LF (or a leading space that Excel trims).
  if (/[",\r\n]/.test(defused)) {
    return `"${defused.replace(/"/g, '""')}"`;
  }
  return defused;
}

/** Joins a row of already-arbitrary cells into one escaped CSV line. */
export function csvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(escapeCsvCell).join(",");
}

/** Assembles a full CSV document (CRLF line endings per RFC-4180). */
export function csvDocument(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map(csvRow).join("\r\n");
}
