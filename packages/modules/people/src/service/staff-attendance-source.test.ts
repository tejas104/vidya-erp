import { describe, expect, it, vi } from "vitest";
import type { Principal, ScopeChecker } from "@vidya/platform";
import { InMemoryOrgRepo, InMemoryPeopleRepo, InMemoryStaffAttendanceRepo, seedOrg } from "../../test-support/fakes";
import { createStaffAttendanceSource } from "./staff-attendance-source";

const admin: Principal = {
  id: "admin-1", kind: "user", displayName: "Admin", roles: ["admin"], scopes: [],
  grants: [], sessionId: "session-1",
};

describe("teacher attendance report source", () => {
  it("denies a teacher or another school before reading register rows", async () => {
    const org = new InMemoryOrgRepo();
    const school = await seedOrg(org);
    const attendance = new InMemoryStaffAttendanceRepo(new InMemoryPeopleRepo());
    const readRows = vi.spyOn(attendance, "forSchoolDate");
    const scopeChecker: ScopeChecker = { check: vi.fn(() => ({ granted: false, reason: "outside school" })) };
    const source = createStaffAttendanceSource({ edition: "school", org, attendance, scopeChecker });
    expect(await source({ ...admin, roles: ["teacher"] }, school.college.id, "2026-09-25")).toEqual({ access: "forbidden" });
    expect(await source(admin, school.college.id, "2026-09-25")).toEqual({ access: "forbidden" });
    expect(readRows).not.toHaveBeenCalled();
  });

  it("returns the entire school day, including unmarked and inactive teachers, to scoped leadership", async () => {
    const org = new InMemoryOrgRepo();
    const school = await seedOrg(org);
    const people = new InMemoryPeopleRepo();
    const attendance = new InMemoryStaffAttendanceRepo(people);
    const first = await people.createTeacher({ collegeId: school.college.id, staffNo: "T01", fullName: "Asha Rao" });
    const second = await people.createTeacher({ collegeId: school.college.id, staffNo: "T02", fullName: "Meera Shah" });
    await people.updateTeacher(second.id, { status: "inactive" });
    await people.createTeacher({ collegeId: "col_else", staffNo: "T03", fullName: "Outside" });
    await attendance.saveBatch({ collegeId: school.college.id, attendedOn: "2026-09-25", markedBy: admin.id,
      entries: [{ teacherId: first.id, status: "absent", note: "Reported ill" }] });
    const scopeChecker: ScopeChecker = { check: vi.fn(() => ({ granted: true, reason: "allowed" })) };
    const source = createStaffAttendanceSource({ edition: "school", org, attendance, scopeChecker });
    const result = await source({ ...admin, roles: ["principal"] }, school.college.id, "2026-09-25");
    expect(result).toMatchObject({ access: "ok", rows: [
      { staffNo: "T01", fullName: "Asha Rao", presence: "absent", note: "Reported ill" },
      { staffNo: "T02", fullName: "Meera Shah", presence: null, teacherStatus: "inactive" },
    ] });
    expect((scopeChecker.check as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toMatchObject({
      module: "people", resourceType: "teacher-attendance", org: { collegeId: school.college.id },
    });
  });
});
