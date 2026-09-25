import ExcelJS from "exceljs";
import type { ReportData } from "../report-data";

// Preserve the CSV export's spreadsheet-injection boundary for free-text cells.
function safeCell(value: string | number): string | number {
  return typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function renderXlsx(data: ReportData): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Vidya";
  workbook.created = new Date(data.generatedAt);
  const overview = workbook.addWorksheet("Overview");
  overview.columns = [{ width: 27 }, { width: 55 }];
  overview.addRow([safeCell(data.title)]);
  overview.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF55309E" } };
  overview.addRow([safeCell(data.subtitle)]);
  overview.addRow(["Academic year", safeCell(data.academicYear)]);
  overview.addRow(["Generated for", safeCell(data.generatedFor)]);
  overview.addRow(["Generated at", safeCell(data.generatedAt)]);
  overview.addRow([]);
  for (const stat of data.stats) overview.addRow([safeCell(stat.label), safeCell(stat.value)]);
  if (data.notes.length) {
    overview.addRow([]);
    overview.addRow(["Notes"]);
    for (const note of data.notes) overview.addRow([safeCell(note)]);
  }

  data.tables.forEach((table, index) => {
    const sheet = workbook.addWorksheet(`Table ${index + 1}`);
    sheet.addRow([safeCell(table.caption)]);
    sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF55309E" } };
    sheet.addRow(table.columns.map(safeCell));
    const heading = sheet.getRow(2);
    heading.font = { bold: true, color: { argb: "FFFFFFFF" } };
    heading.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF55309E" } };
    for (const row of table.rows) sheet.addRow(row.map(safeCell));
    sheet.getRow(2).height = 24;
    sheet.views = [{ state: "frozen", ySplit: 2 }];
    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: Math.max(2, table.rows.length + 2), column: Math.max(1, table.columns.length) } };
    sheet.columns.forEach((column, columnIndex) => {
      const values = [table.columns[columnIndex] ?? "", ...table.rows.map((row) => String(row[columnIndex] ?? ""))];
      column.width = Math.min(44, Math.max(14, ...values.map((value) => value.length + 3)));
    });
  });

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
