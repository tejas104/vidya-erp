import { describe, expect, it, vi } from "vitest";
import { ProgressionService } from "./progression-service";
import { ProgressionReversalConflictError } from "../repo/progression-repo";

const org = { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" };
const attribution = { requestId: "req_1", actorType: "user" as const, actorId: "admin_1" };
const request = { studentId: "stu_1", sourceEnrollmentId: "enr_1", reason: "Wrong pupil", org, attribution };

describe("one-pupil progression correction evidence", () => {
  it("uses the original audit's exact enrollment and family dates", async () => {
    const reverse = vi.fn().mockResolvedValue({ correctionId: "prc_1", reinstatedEnrollmentId: "enr_3", receipt: {} });
    const service = new ProgressionService({
      people: {} as never, org: {} as never, relationships: async () => [],
      repo: { apply: vi.fn() as never, reverse },
      readAudit: async () => [{
        id: 5, action: "people.student-progressed",
        details: {
          closedEnrollmentId: "enr_1", newEnrollmentId: null, outcome: "transferred_out", endsOn: "2026-09-25",
          sectionId: "sec_1", academicYear: "2026-27", next: null,
          before: { status: "active" }, after: { status: "transferred" },
          familyAccess: [{
            relationshipId: "rel_1",
            before: { validUntil: null, historicalAccessUntil: null },
            after: { validUntil: "2026-09-26T00:00:00.000Z", historicalAccessUntil: "2026-12-25T00:00:00.000Z" },
          }],
        },
      }],
    });
    await service.reverse(request);
    expect(reverse).toHaveBeenCalledWith(expect.objectContaining({
      studentId: "stu_1", sourceEnrollmentId: "enr_1", nextEnrollmentId: null,
      outcome: "transferred_out", endsOn: "2026-09-25", sectionId: "sec_1", academicYear: "2026-27",
      next: null, statusBefore: "active", statusAfter: "transferred",
      familyAccess: [expect.objectContaining({ relationshipId: "rel_1" })],
    }));
  });

  it("refuses a guessed enrollment without an applied audit event", async () => {
    const reverse = vi.fn();
    const service = new ProgressionService({
      people: {} as never, org: {} as never, relationships: async () => [],
      repo: { apply: vi.fn() as never, reverse },
      readAudit: async () => [],
    });
    await expect(service.reverse(request)).rejects.toBeInstanceOf(ProgressionReversalConflictError);
    expect(reverse).not.toHaveBeenCalled();
  });

  it("passes the recorded next-year placement to the transactional correction", async () => {
    const reverse = vi.fn().mockResolvedValue({ correctionId: "prc_1", reinstatedEnrollmentId: "enr_3", receipt: {} });
    const next = { sectionId: "sec_2", academicYear: "2027-28", startsOn: "2027-04-01" };
    const service = new ProgressionService({
      people: {} as never, org: {} as never, relationships: async () => [],
      repo: { apply: vi.fn() as never, reverse },
      readAudit: async () => [{
        id: 6, action: "people.student-progressed",
        details: {
          closedEnrollmentId: "enr_1", newEnrollmentId: "enr_2", outcome: "promoted", endsOn: "2027-03-31",
          sectionId: "sec_1", academicYear: "2026-27", next,
          before: { status: "active" }, after: { status: "active" }, familyAccess: [],
        },
      }],
    });
    await service.reverse(request);
    expect(reverse).toHaveBeenCalledWith(expect.objectContaining({ nextEnrollmentId: "enr_2", next }));
  });
});
