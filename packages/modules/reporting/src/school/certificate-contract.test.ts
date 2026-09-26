import { describe, expect, it } from "vitest";
import { CERTIFICATE_SNAPSHOT_VERSION, certificateSnapshotSchema,
  parseStoredCertificateSnapshot } from "./certificate-contract";

const common = {
  snapshotVersion: CERTIFICATE_SNAPSHOT_VERSION,
  schoolId: "11111111-1111-4111-8111-111111111111",
  studentId: "22222222-2222-4222-8222-222222222222",
  enrollmentId: "33333333-3333-4333-8333-333333333333",
  number: "GF/2026-27/001",
  academicYear: "2026-27",
  issuedAt: "2026-09-26T06:30:00.000Z",
  issuedBy: "principal",
  correctionOfNumber: null,
  student: { fullName: "Asha Kulkarni", admissionNo: "GF-001" },
  enrollment: { className: "Class 7", sectionName: "A", startsOn: "2026-06-01", endsOn: null },
  style: { schoolName: "Greenfield School", accentColor: "#176A57", footerText: "School office" },
} as const;

describe("school certificate stored contract", () => {
  it("accepts a bonafide record for a current or former pupil", () => {
    expect(certificateSnapshotSchema.safeParse({ ...common, kind: "bonafide" }).success).toBe(true);
    expect(certificateSnapshotSchema.safeParse({ ...common, kind: "bonafide",
      enrollment: { ...common.enrollment, endsOn: "2026-09-20" } }).success).toBe(true);
  });

  it("requires recorded transfer provenance or a specific approved exception", () => {
    const transfer = { ...common, kind: "transfer", leavingOn: "2026-09-26",
      leavingReason: "Family moved", enrollment: { ...common.enrollment, endsOn: "2026-09-26" },
      source: { kind: "recorded_transfer", progressionAuditId: "44444444-4444-4444-8444-444444444444" } };
    expect(certificateSnapshotSchema.safeParse(transfer).success).toBe(true);
    expect(certificateSnapshotSchema.safeParse({ ...transfer, enrollment: common.enrollment }).success).toBe(false);
    expect(certificateSnapshotSchema.safeParse({ ...transfer,
      source: { kind: "manual_exception", approvalAuditId: "55555555-5555-4555-8555-555555555555",
        exceptionReason: "Principal approved after paper record review" } }).success).toBe(true);
    expect(certificateSnapshotSchema.safeParse({ ...transfer,
      source: { kind: "manual_exception", exceptionReason: "Missing approval" } }).success).toBe(false);
  });

  it("refuses invented dates, corrected numbers reused, and unknown versions", () => {
    expect(certificateSnapshotSchema.safeParse({ ...common, kind: "bonafide",
      enrollment: { ...common.enrollment, startsOn: "2026-02-30" } }).success).toBe(false);
    expect(certificateSnapshotSchema.safeParse({ ...common, kind: "bonafide",
      correctionOfNumber: common.number }).success).toBe(false);
    expect(parseStoredCertificateSnapshot({ ...common, kind: "bonafide",
      snapshotVersion: "school-certificate.snapshot.v2" })).toBeNull();
  });
});
