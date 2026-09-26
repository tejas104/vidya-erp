import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CERTIFICATE_SNAPSHOT_VERSION, type CertificateSnapshot } from "./certificate-contract";
import { renderCertificatePdf } from "./certificate-pdf";

function pdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const streams = new Map<number, string>();
  const pageRefs: number[] = [];
  for (const match of raw.matchAll(/(\d+) 0 obj\r?\n((?:(?!endobj)[\s\S])*?)endobj/g)) {
    const body = match[2]!;
    const stream = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (stream) {
      try { streams.set(Number(match[1]), inflateSync(Buffer.from(stream[1]!, "latin1")).toString("latin1")); }
      catch { /* Other streams are not page text. */ }
    }
    if (/\/Type \/Page\b/.test(body) && !/\/Type \/Pages\b/.test(body)) {
      const ref = body.match(/\/Contents (\d+) 0 R/);
      if (ref) pageRefs.push(Number(ref[1]));
    }
  }
  return pageRefs.map((ref) => {
    let text = "";
    for (const token of streams.get(ref)?.match(/<([0-9A-Fa-f]+)>/g) ?? []) {
      const hex = token.slice(1, -1);
      for (let i = 0; i + 1 < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return text;
  }).join("\n");
}

const common = {
  snapshotVersion: CERTIFICATE_SNAPSHOT_VERSION,
  schoolId: "11111111-1111-4111-8111-111111111111",
  studentId: "22222222-2222-4222-8222-222222222222",
  enrollmentId: "33333333-3333-4333-8333-333333333333",
  number: "GF/2026-27/001", academicYear: "2026-27",
  issuedAt: "2026-09-26T06:30:00.000Z", issuedBy: "principal" as const,
  correctionOfNumber: null,
  student: { fullName: "Asha Kulkarni", admissionNo: "GF-001" },
  enrollment: { className: "Class 7", sectionName: "A", startsOn: "2026-06-01", endsOn: "2026-09-26" },
  style: { schoolName: "Greenfield School", accentColor: "#176A57", footerText: "School office copy" },
};

describe("school certificate PDF", () => {
  it("prints recorded transfer facts and both signatory roles without internal audit IDs", async () => {
    const snapshot: CertificateSnapshot = { ...common, kind: "transfer", leavingOn: "2026-09-26",
      leavingReason: "Family moved to Pune", source: { kind: "recorded_transfer",
        progressionAuditId: "44444444-4444-4444-8444-444444444444" } };
    const bytes = await renderCertificatePdf(snapshot);
    const text = pdfText(bytes);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    for (const expected of ["Greenfield School", "Transfer certificate", "GF/2026-27/001",
      "Asha Kulkarni", "GF-001", "Family moved to Pune", "26 September 2026",
      "School administrator", "Principal", "School office copy"]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("44444444-4444-4444-8444-444444444444");
  });

  it("labels manual exceptions and accurately uses past tense for former pupils", async () => {
    const manual: CertificateSnapshot = { ...common, kind: "transfer", leavingOn: "2026-09-26",
      leavingReason: "Family relocated", source: { kind: "manual_exception",
        approvalAuditId: "55555555-5555-4555-8555-555555555555", exceptionReason: "Paper file verified" } };
    expect(pdfText(await renderCertificatePdf(manual))).toContain("approved manual exception");
    const bonafide: CertificateSnapshot = { ...common, kind: "bonafide" };
    const text = pdfText(await renderCertificatePdf(bonafide));
    expect(text).toContain("was enrolled");
    expect(text).not.toContain("is enrolled");
  });

  it("keeps long school and pupil names plus the complete reason in the PDF", async () => {
    const longReason = `Relocated after the family completed a documented move to another city. ${"Record reviewed. ".repeat(12)}`.trim();
    const snapshot: CertificateSnapshot = { ...common, kind: "transfer",
      student: { ...common.student, fullName: "Ananya Lakshmi Narayan Subramanian Sharma Kulkarni" },
      style: { ...common.style, schoolName: "Greenfield International School of Learning and Community Development" },
      leavingOn: "2026-09-26", leavingReason: longReason,
      source: { kind: "recorded_transfer", progressionAuditId: "44444444-4444-4444-8444-444444444444" } };
    const text = pdfText(await renderCertificatePdf(snapshot));
    expect(text).toContain(snapshot.student.fullName);
    expect(text).toContain(snapshot.style.schoolName);
    expect(text).toContain("Record reviewed.");
  });
});
