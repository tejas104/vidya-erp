/** Generate one fictional PDF for visual QA of the N7 certificate renderer. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CERTIFICATE_SNAPSHOT_VERSION, renderCertificatePdf,
  type CertificateSnapshot } from "@vidya/module-reporting";

const snapshot: CertificateSnapshot = {
  snapshotVersion: CERTIFICATE_SNAPSHOT_VERSION,
  kind: "transfer",
  schoolId: "11111111-1111-4111-8111-111111111111",
  studentId: "22222222-2222-4222-8222-222222222222",
  enrollmentId: "33333333-3333-4333-8333-333333333333",
  number: "DEMO/2026-27/001",
  academicYear: "2026-27",
  issuedAt: "2026-09-26T06:30:00.000Z",
  issuedBy: "principal",
  correctionOfNumber: null,
  student: { fullName: "Asha Kulkarni", admissionNo: "DEMO-001" },
  enrollment: { className: "Class 7", sectionName: "A", startsOn: "2026-06-01", endsOn: "2026-09-26" },
  leavingOn: "2026-09-26",
  leavingReason: "Family relocated to another city",
  source: { kind: "recorded_transfer" },
  style: { schoolName: "Vidya Fictional Demo School", accentColor: "#176A57",
    footerText: "SYNTHETIC PREVIEW - not issued by a school" },
};

const directory = resolve("output/pdf");
await mkdir(directory, { recursive: true });
const path = resolve(directory, "synthetic-transfer-certificate.pdf");
await writeFile(path, await renderCertificatePdf(snapshot));
console.log(path);
