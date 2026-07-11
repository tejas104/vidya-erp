import { csvDocument } from "../escape-csv";
import type { ReportData } from "../report-data";

/**
 * Renders a report to CSV. EVERY cell — including report content, student
 * names and any free text — passes through escapeCsvCell, so a crafted name
 * cannot become a spreadsheet formula on the recipient's machine (ADR-0020).
 */
export function renderCsv(data: ReportData): string {
  const rows: (string | number)[][] = [];
  rows.push([data.title]);
  rows.push([data.subtitle]);
  rows.push(["Academic year", data.academicYear]);
  rows.push(["Generated for", data.generatedFor]);
  rows.push(["Generated at", data.generatedAt]);
  rows.push([]);
  for (const stat of data.stats) {
    rows.push([stat.label, stat.value]);
  }
  for (const table of data.tables) {
    rows.push([]);
    rows.push([table.caption]);
    rows.push([...table.columns]);
    for (const row of table.rows) {
      rows.push([...row]);
    }
  }
  if (data.notes.length > 0) {
    rows.push([]);
    rows.push(["Notes"]);
    for (const note of data.notes) {
      rows.push([note]);
    }
  }
  return csvDocument(rows);
}
