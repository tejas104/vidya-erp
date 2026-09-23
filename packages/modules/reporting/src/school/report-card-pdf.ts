import PDFDocument from "pdfkit";
import type { ReportCardSnapshot } from "./report-card-contract";

/**
 * Renders an issued report card to PDF with pdfkit — pure JS, built-in fonts,
 * no headless browser and no runtime CDN (ADR-0021).
 *
 * THE INPUT IS THE STORED SNAPSHOT AND NOTHING ELSE. This function performs no
 * lookups and no arithmetic; it lays out figures that were computed and frozen
 * at generation time. That is what makes a reprint reproduce the original
 * document even after the underlying marks have been corrected.
 *
 * Missing values render as "Not recorded" rather than as a dash, a zero or a
 * blank, so a reader can tell the difference between a pupil who scored
 * nothing and a mark that was never entered.
 */

const INK = "#1a2233";
const MUTED = "#565c68";
const RULE = "#d6cfbc";
const ACCENT = "#b23a2e";

const NOT_RECORDED = "Not recorded";

function percent(value: number | null): string {
  return value === null ? NOT_RECORDED : `${value.toFixed(2)}%`;
}

export function renderReportCardPdf(
  snapshot: ReportCardSnapshot,
  issuedAt: Date,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const title = `Report card — ${snapshot.student.fullName} — ${snapshot.term.name}`;
    // CreationDate is pinned to when the snapshot was ISSUED, not to now.
    // pdfkit otherwise stamps the current clock, which would both make a
    // reprint claim today as its creation date and make the bytes differ on
    // every render of the same frozen snapshot.
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: title, CreationDate: issuedAt },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
    };
    const rule = () => {
      doc.strokeColor(RULE).lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
    };

    // Masthead
    doc.fillColor(ACCENT).fontSize(9).font("Helvetica-Bold").text("VIDYA", left, doc.y, { characterSpacing: 2 });
    doc.moveDown(0.2);
    doc.fillColor(INK).fontSize(20).font("Helvetica-Bold").text("Report card", { lineGap: 1 });
    doc.fillColor(MUTED).fontSize(13).font("Helvetica").text(
      `${snapshot.term.name}  ·  ${snapshot.term.academicYear}`,
    );
    doc.moveDown(0.6);
    rule();
    doc.moveDown(0.8);

    // Identity
    doc.fillColor(INK).fontSize(15).font("Helvetica-Bold").text(snapshot.student.fullName, left);
    doc.fillColor(MUTED).fontSize(10).font("Helvetica").text(
      `Admission no. ${snapshot.student.admissionNo}  ·  term ${snapshot.term.startsOn} to ${snapshot.term.endsOn}`,
    );
    doc.moveDown(0.9);

    // Subjects
    doc.fillColor(INK).fontSize(12).font("Helvetica-Bold").text("Subjects", left);
    doc.moveDown(0.3);

    const cols = [width * 0.5, width * 0.25, width * 0.25];
    const drawRow = (cells: readonly string[], bold: boolean) => {
      ensureSpace(22);
      const rowY = doc.y;
      let maxH = 0;
      let x = left;
      cells.forEach((cell, index) => {
        const colWidth = cols[index] ?? 0;
        doc
          .fillColor(bold ? MUTED : INK)
          .fontSize(bold ? 8.5 : 10)
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .text(cell, x, rowY, { width: colWidth - 6, lineBreak: true });
        maxH = Math.max(maxH, doc.y - rowY);
        x += colWidth;
      });
      doc.y = rowY + Math.max(maxH, 12) + 4;
      doc.strokeColor(RULE).lineWidth(0.5).moveTo(left, doc.y - 2).lineTo(right, doc.y - 2).stroke();
    };

    drawRow(["Subject", "Percentage", "Grade"], true);
    if (snapshot.subjects.length === 0) {
      doc.fillColor(MUTED).fontSize(9).font("Helvetica-Oblique").text("No subjects were assessed this term.", left);
      doc.moveDown(0.5);
    } else {
      for (const subject of snapshot.subjects) {
        drawRow([
          subject.subjectName,
          subject.complete ? percent(subject.percentage) : NOT_RECORDED,
          subject.complete ? (subject.grade ?? "No grade") : NOT_RECORDED,
        ], false);
      }
    }

    // Summary
    doc.moveDown(0.8);
    ensureSpace(70);
    doc.fillColor(INK).fontSize(12).font("Helvetica-Bold").text("Summary", left);
    doc.moveDown(0.4);

    const summaryY = doc.y;
    const half = width / 2;
    doc.fillColor(MUTED).fontSize(9).font("Helvetica").text("Overall", left, summaryY, { width: half - 8 });
    doc.fillColor(INK).fontSize(16).font("Helvetica-Bold").text(
      snapshot.overall.complete
        ? `${percent(snapshot.overall.percentage)}${snapshot.overall.grade === null ? "" : `  ·  ${snapshot.overall.grade}`}`
        : NOT_RECORDED,
      left,
      doc.y,
      { width: half - 8 },
    );
    const afterOverall = doc.y;

    doc.fillColor(MUTED).fontSize(9).font("Helvetica").text("Attendance", left + half, summaryY, { width: half - 8 });
    doc.fillColor(INK).fontSize(16).font("Helvetica-Bold").text(
      snapshot.attendance.complete ? percent(snapshot.attendance.percentage) : NOT_RECORDED,
      left + half,
      doc.y,
      { width: half - 8 },
    );
    doc.fillColor(MUTED).fontSize(9).font("Helvetica").text(
      snapshot.attendance.presentEquivalentDays === null
        ? `${snapshot.attendance.eligibleDays} eligible days recorded`
        : `${snapshot.attendance.presentEquivalentDays} of ${snapshot.attendance.eligibleDays} eligible days`,
      left + half,
      doc.y,
      { width: half - 8 },
    );
    doc.y = Math.max(afterOverall, doc.y) + 8;

    // Notes — the same warnings the issuing user saw and accepted.
    if (snapshot.warnings.length > 0 || snapshot.attendance.missingDates.length > 0) {
      ensureSpace(50);
      doc.moveDown(0.6);
      rule();
      doc.moveDown(0.5);
      doc.fillColor(MUTED).fontSize(9).font("Helvetica-Bold").text("Notes on completeness", left);
      doc.moveDown(0.2);
      for (const warning of snapshot.warnings) {
        doc.fillColor(MUTED).fontSize(9).font("Helvetica").text(`•  ${warning}`, { lineGap: 1 });
      }
      if (snapshot.attendance.missingDates.length > 0) {
        doc.fillColor(MUTED).fontSize(9).font("Helvetica").text(
          `•  No attendance was recorded on: ${snapshot.attendance.missingDates.join(", ")}.`,
          { lineGap: 1 },
        );
      }
    }

    // Provenance footer — what produced these figures, so a disputed card can
    // be reconciled against the engine version that issued it.
    ensureSpace(40);
    doc.moveDown(0.8);
    rule();
    doc.moveDown(0.4);
    doc.fillColor(MUTED).fontSize(7.5).font("Helvetica").text(
      `Issued ${issuedAt.toISOString()}  ·  snapshot ${snapshot.snapshotVersion}  ·  ` +
        `results ${snapshot.provenance.resultEngineVersion} (${snapshot.provenance.withinTypeAggregation})  ·  ` +
        `attendance ${snapshot.provenance.attendanceEngineVersion} ` +
        `(late ${snapshot.provenance.lateTreatment}, excused ${snapshot.provenance.excusedTreatment}, ` +
        `half-day ${snapshot.provenance.halfDayTreatment})`,
      left,
      doc.y,
      { width },
    );

    doc.end();
  });
}
