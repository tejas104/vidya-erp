import PDFDocument from "pdfkit";
import type { ReportData } from "../report-data";

/**
 * Renders the class-credentials report kind: one A4 page per class (one
 * `ReportData` table = one class), laid out as cuttable slips so a class
 * teacher can cut the printed sheet into per-student hand-outs. Mirrors
 * render/pdf.ts's pdfkit conventions (A4, margin 48, same ink/muted/rule
 * palette, stream-to-Buffer pattern) — see ADR-0021 for why pdfkit and not
 * a headless browser. A separate file rather than a branch in pdf.ts because
 * the page-per-class + cut-line layout does not fit pdf.ts's continuous,
 * multi-table-per-page flow.
 *
 * SECURITY: this is the one rendering of a whole class's plaintext temporary
 * passwords (SECURITY.md "known limitations" — durable artifact in object
 * storage). This file draws whatever `data` it is handed; it does not decide
 * who may request or download it — that is report-data.ts's canProduce and
 * the standard reporting scope/audit chokepoint.
 *
 * ponytail: assumes one class's roster fits one page (~25-30 rows at this
 * type size before it runs past the bottom margin) — matches the brief's
 * "one page per class" exactly. If a section regularly exceeds that, add
 * same-class continuation pages keyed off ensureSpace, mirroring pdf.ts.
 */

const INK = "#1a2233";
const MUTED = "#565c68";
const RULE = "#d6cfbc";
const ACCENT = "#b23a2e";

const FIRST_LOGIN_NOTE =
  "First login: sign in with the username and temporary password above, then set a new password when prompted.";

export function renderCredentialSheet(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: data.title } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    data.tables.forEach((table, index) => {
      if (index > 0) doc.addPage();

      // Masthead
      doc.fillColor(ACCENT).fontSize(9).font("Helvetica-Bold").text("VIDYA", left, doc.y, { characterSpacing: 2 });
      doc.moveDown(0.2);
      doc.fillColor(INK).fontSize(18).font("Helvetica-Bold").text(data.title, { lineGap: 1 });
      doc.fillColor(MUTED).fontSize(12).font("Helvetica").text(table.caption);
      doc.fontSize(9).fillColor(MUTED).text(
        `Academic year ${data.academicYear}  ·  generated for ${data.generatedFor}  ·  ${data.generatedAt}`,
      );
      doc.moveDown(0.6);
      doc.strokeColor(RULE).lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
      doc.moveDown(0.6);

      // Column header
      const cols = table.columns.length;
      const colWidth = width / cols;
      const headerY = doc.y;
      table.columns.forEach((col, colIndex) => {
        doc
          .fillColor(MUTED)
          .fontSize(8.5)
          .font("Helvetica-Bold")
          .text(String(col), left + colIndex * colWidth, headerY, { width: colWidth - 6 });
      });
      doc.y = headerY + 14;
      doc.strokeColor(RULE).lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
      doc.moveDown(0.4);

      // Rows — a dashed cut-line under each one so the sheet can be cut into
      // individual slips.
      if (table.rows.length === 0) {
        doc.fillColor(MUTED).fontSize(9).font("Helvetica-Oblique").text("No credentials issued for this class.", left);
        doc.moveDown(0.5);
      } else {
        for (const row of table.rows) {
          const rowY = doc.y;
          let maxH = 0;
          row.forEach((cell, colIndex) => {
            doc
              .fillColor(INK)
              .fontSize(10)
              .font("Helvetica")
              .text(String(cell), left + colIndex * colWidth, rowY, { width: colWidth - 6 });
            maxH = Math.max(maxH, doc.y - rowY);
          });
          doc.y = rowY + Math.max(maxH, 14) + 6;
          doc
            .dash(2, { space: 2 })
            .strokeColor(RULE)
            .lineWidth(0.75)
            .moveTo(left, doc.y - 3)
            .lineTo(right, doc.y - 3)
            .stroke()
            .undash();
        }
      }

      // Footer: first-login instructions, plus any caveat report-data.ts
      // attached to this report (e.g. the plaintext-password warning).
      doc.moveDown(0.6);
      doc.fillColor(MUTED).fontSize(8.5).font("Helvetica-Oblique").text(FIRST_LOGIN_NOTE, left, doc.y, { width });
      for (const note of data.notes) {
        doc.moveDown(0.2);
        doc.fillColor(MUTED).fontSize(8.5).font("Helvetica-Oblique").text(note, left, doc.y, { width });
      }
    });

    doc.end();
  });
}
