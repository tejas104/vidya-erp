import { describe, expect, it } from "vitest";
import type { CertificateSource } from "@vidya/module-people";
import { assertCertificateSource, certificateNumber, CertificateIssueConflict } from "./certificate-repo";

const source: CertificateSource = {
  org: { collegeId: "col_school", departmentId: "dep_school", classId: "cls_8", sectionId: "sec_8a" },
  schoolName: "Greenfield School",
  student: { id: "stu_asha", fullName: "Asha Kulkarni", admissionNo: "GF-001" },
  enrollment: { id: "enr_asha", academicYear: "2026-27", className: "Standard 8", sectionName: "A",
    startsOn: "2026-06-01", endsOn: "2026-09-26", status: "withdrawn",
    outcome: "transferred_out", outcomeReason: "Family moved", corrected: false },
};

describe("school certificate issuance rules", () => {
  it("allocates a stable year-scoped number and rejects invalid counters", () => {
    expect(certificateNumber("2026-27", 1)).toBe("CERT/2026-27/000001");
    expect(certificateNumber("2026-27", 999999)).toBe("CERT/2026-27/999999");
    expect(() => certificateNumber("2026-27", 0)).toThrow(CertificateIssueConflict);
    expect(() => certificateNumber("2026-27", 1000000)).toThrow(CertificateIssueConflict);
    expect(() => certificateNumber("2026/27", 1)).toThrow(CertificateIssueConflict);
  });

  it("allows a recorded, uncorrected transfer and any verified enrollment for bonafide", () => {
    expect(() => assertCertificateSource("transfer", source)).not.toThrow();
    expect(() => assertCertificateSource("bonafide", { ...source, enrollment: { ...source.enrollment,
      status: "completed", outcome: "graduated", corrected: true } })).not.toThrow();
  });

  it.each([
    { status: "enrolled" }, { outcome: "graduated" }, { corrected: true },
    { endsOn: null }, { outcomeReason: null }, { outcomeReason: "  " },
  ])("refuses a transfer without a current recorded exit: %j", (change) => {
    expect(() => assertCertificateSource("transfer", { ...source,
      enrollment: { ...source.enrollment, ...change } })).toThrow(CertificateIssueConflict);
  });
});
