import PDFDocument from "pdfkit";
import { certificateSnapshotSchema, type CertificateSnapshot } from "./certificate-contract";

const INK = "#1a2233";
const MUTED = "#565c68";
const RULE = "#d6cfbc";
const PANEL = "#f7f5ef";

function dateLabel(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric",
    timeZone: "UTC" }).format(date);
}

/** Render a stored, validated issuance snapshot. No live pupil or policy lookup. */
export function renderCertificatePdf(raw: CertificateSnapshot): Promise<Buffer> {
  const snapshot = certificateSnapshotSchema.parse(raw);
  return new Promise((resolve, reject) => {
    const title = snapshot.kind === "transfer" ? "Transfer certificate" : "Bonafide certificate";
    const doc = new PDFDocument({ size: "A4", margin: 48, info: {
      Title: `${title} - ${snapshot.student.fullName} - ${snapshot.number}`,
      CreationDate: new Date(snapshot.issuedAt),
    } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const right = left + width;
    const accent = snapshot.style.accentColor;

    doc.fillColor(accent).font("Helvetica-Bold").fontSize(11);
    const schoolHeight = doc.heightOfString(snapshot.style.schoolName,
      { width: width * 0.7, characterSpacing: 1 });
    doc.text(snapshot.style.schoolName, left, 54, { width: width * 0.7, characterSpacing: 1 });
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8)
      .text("OFFICIAL SCHOOL RECORD", left + width * 0.7, 57,
        { width: width * 0.3, align: "right", characterSpacing: 1 });
    const mastheadRuleY = Math.max(91, 54 + schoolHeight + 15);
    doc.strokeColor(accent).lineWidth(2).moveTo(left, mastheadRuleY).lineTo(right, mastheadRuleY).stroke();

    const titleY = mastheadRuleY + 30;
    const metaY = titleY + 44;
    const dividerY = metaY + 25;
    const panelY = dividerY + 25;
    doc.fillColor(INK).font("Times-Bold").fontSize(26).text(title, left, titleY, { width });
    doc.fillColor(MUTED).font("Helvetica").fontSize(10)
      .text(`Certificate no. ${snapshot.number}`, left, metaY, { width: width * 0.6 });
    doc.text(`Issued ${dateLabel(snapshot.issuedAt)}`, left + width * 0.6, metaY,
      { width: width * 0.4, align: "right" });
    doc.strokeColor(RULE).lineWidth(0.8).moveTo(left, dividerY).lineTo(right, dividerY).stroke();

    const nameY = panelY + 33;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(16);
    const nameHeight = doc.heightOfString(snapshot.student.fullName, { width: width - 36 });
    const admissionY = nameY + Math.max(33, nameHeight + 12);
    const classY = admissionY + 21;
    doc.fillColor(MUTED).font("Helvetica").fontSize(10);
    const classText = `${snapshot.enrollment.className} / Section ${snapshot.enrollment.sectionName}`;
    const classHeight = doc.heightOfString(classText, { width: width - 36 });
    const panelBottom = classY + classHeight + 17;
    doc.roundedRect(left, panelY, width, panelBottom - panelY, 8).fill(PANEL);
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("PUPIL", left + 18, panelY + 16);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(16)
      .text(snapshot.student.fullName, left + 18, nameY, { width: width - 36 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(10)
      .text(`Admission no. ${snapshot.student.admissionNo}`, left + 18, admissionY, { width: width - 36 });
    doc.text(classText, left + 18, classY, { width: width - 36 });

    const enrollmentEnd = snapshot.enrollment.endsOn === null
      ? "present" : dateLabel(snapshot.enrollment.endsOn);
    const period = `${dateLabel(snapshot.enrollment.startsOn)} to ${enrollmentEnd}`;
    const enrollmentY = panelBottom + 25;
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text("ENROLLMENT ON RECORD", left, enrollmentY);
    doc.fillColor(INK).font("Helvetica").fontSize(11).text(period, left, enrollmentY + 20, { width });
    doc.fillColor(MUTED).fontSize(9).text(`Academic year ${snapshot.academicYear}`, left, enrollmentY + 41);

    const sectionRuleY = enrollmentY + 71;
    const bodyY = sectionRuleY + 45;
    doc.strokeColor(RULE).lineWidth(0.8).moveTo(left, sectionRuleY).lineTo(right, sectionRuleY).stroke();
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text("CERTIFICATION", left, sectionRuleY + 24);
    const body = snapshot.kind === "bonafide"
      ? `This certifies that ${snapshot.student.fullName}, admission number ${snapshot.student.admissionNo}, ` +
        `${snapshot.enrollment.endsOn === null ? "is" : "was"} enrolled at ${snapshot.style.schoolName} ` +
        `in ${snapshot.enrollment.className}, Section ${snapshot.enrollment.sectionName}, ` +
        `for the period ${period}.`
      : `This certifies that ${snapshot.student.fullName}, admission number ${snapshot.student.admissionNo}, ` +
        `was enrolled at ${snapshot.style.schoolName} in ${snapshot.enrollment.className}, ` +
        `Section ${snapshot.enrollment.sectionName}. The leaving date is ${dateLabel(snapshot.leavingOn)}. ` +
        `Reason for leaving: ${snapshot.leavingReason}.`;
    doc.fillColor(INK).font("Times-Roman").fontSize(13)
      .text(body, left, bodyY, { width, lineGap: 6, align: "left" });

    if (snapshot.kind === "transfer" && snapshot.source.kind === "manual_exception") {
      doc.moveDown(0.6);
      doc.fillColor(MUTED).font("Helvetica").fontSize(9)
        .text("Issued under an approved manual exception.", left, doc.y, { width });
    }
    if (snapshot.correctionOfNumber !== null) {
      doc.moveDown(0.6);
      doc.fillColor(MUTED).font("Helvetica").fontSize(9)
        .text(`Correction of certificate ${snapshot.correctionOfNumber}; both records remain on file.`,
          left, doc.y, { width });
    }

    const signatureY = Math.max(bodyY + 178, doc.y + 42);
    if (signatureY + 85 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const signY = signatureY + 85 > doc.page.height - doc.page.margins.bottom ? 96 : signatureY;
    const half = (width - 36) / 2;
    for (const [x, label] of [[left, "School administrator"], [left + half + 36, "Principal"]] as const) {
      doc.strokeColor(RULE).lineWidth(0.8).moveTo(x, signY + 25).lineTo(x + half, signY + 25).stroke();
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(label, x, signY + 33, { width: half });
    }
    const footerY = doc.page.height - doc.page.margins.bottom - 32;
    doc.strokeColor(RULE).lineWidth(0.8).moveTo(left, footerY).lineTo(right, footerY).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8)
      .text(snapshot.style.footerText || `Certificate ${snapshot.number} - ${snapshot.academicYear}`,
        left, footerY + 8, { width });
    doc.end();
  });
}
