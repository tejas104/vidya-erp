import PDFDocument from "pdfkit";
import type { ReportData } from "../report-data";

/**
 * Renders a report to PDF with pdfkit — pure JS, built-in fonts, no headless
 * browser and no runtime CDN (ADR-0021). Streams to a Buffer for upload to
 * MinIO. The content is already scope-filtered (ADR-0020); this only lays it
 * out. Plain text throughout, so the CSV-injection concern does not apply to
 * PDF, but the same scoped data feeds both.
 */

const INK = "#1a2233";
const MUTED = "#565c68";
const RULE = "#d6cfbc";
const ACCENT = "#b23a2e";

export function renderPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: data.title } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
    };

    // Masthead
    doc.fillColor(ACCENT).fontSize(9).font("Helvetica-Bold").text("VIDYA", left, doc.y, { characterSpacing: 2 });
    doc.moveDown(0.2);
    doc.fillColor(INK).fontSize(20).font("Helvetica-Bold").text(data.title, { lineGap: 1 });
    doc.fillColor(MUTED).fontSize(13).font("Helvetica").text(data.subtitle);
    doc.fontSize(9).fillColor(MUTED).text(
      `Academic year ${data.academicYear}  ·  generated for ${data.generatedFor}  ·  ${data.generatedAt}`,
    );
    doc.moveDown(0.6);
    doc.strokeColor(RULE).lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
    doc.moveDown(0.8);

    // Stat row
    if (data.stats.length > 0) {
      const statWidth = width / data.stats.length;
      const statY = doc.y;
      data.stats.forEach((stat, index) => {
        const x = left + index * statWidth;
        doc.fillColor(INK).fontSize(18).font("Helvetica-Bold").text(stat.value, x, statY, { width: statWidth - 8 });
        doc.fillColor(MUTED).fontSize(9).font("Helvetica").text(stat.label, x, doc.y, { width: statWidth - 8 });
      });
      doc.moveDown(1);
    }

    // Tables
    for (const table of data.tables) {
      ensureSpace(60);
      doc.moveDown(0.4);
      doc.fillColor(INK).fontSize(12).font("Helvetica-Bold").text(table.caption, left);
      doc.moveDown(0.3);

      const cols = table.columns.length;
      const colWidth = width / cols;
      const drawRow = (cells: readonly (string | number)[], bold: boolean) => {
        ensureSpace(22);
        const rowY = doc.y;
        let maxH = 0;
        cells.forEach((cell, index) => {
          const x = left + index * colWidth;
          doc
            .fillColor(bold ? MUTED : INK)
            .fontSize(bold ? 8.5 : 10)
            .font(bold ? "Helvetica-Bold" : "Helvetica")
            .text(String(cell), x, rowY, { width: colWidth - 6, lineBreak: true });
          maxH = Math.max(maxH, doc.y - rowY);
        });
        doc.y = rowY + Math.max(maxH, 12) + 4;
        doc.strokeColor(RULE).lineWidth(0.5).moveTo(left, doc.y - 2).lineTo(right, doc.y - 2).stroke();
      };

      drawRow(table.columns, true);
      if (table.rows.length === 0) {
        doc.fillColor(MUTED).fontSize(9).font("Helvetica-Oblique").text("No rows.", left);
        doc.moveDown(0.5);
      } else {
        for (const row of table.rows) {
          drawRow(row, false);
        }
      }
    }

    // Notes
    if (data.notes.length > 0) {
      ensureSpace(40);
      doc.moveDown(0.8);
      doc.fillColor(MUTED).fontSize(9).font("Helvetica-Bold").text("Notes");
      for (const note of data.notes) {
        doc.fillColor(MUTED).fontSize(9).font("Helvetica").text(`•  ${note}`, { lineGap: 1 });
      }
    }

    doc.end();
  });
}
