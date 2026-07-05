import { describe, expect, it } from "vitest";
import { PeopleService, UnknownReferenceError } from "./people-service";
import { InMemoryOrgRepo, InMemoryPeopleRepo, seedOrg } from "../../test-support/fakes";

async function makeHarness() {
  const orgRepo = new InMemoryOrgRepo();
  const repo = new InMemoryPeopleRepo();
  const org = await seedOrg(orgRepo);
  const service = new PeopleService({ repo, orgRepo });
  return { service, repo, orgRepo, org };
}

describe("students & org position", () => {
  it("rejects creation in an unknown college", async () => {
    const { service } = await makeHarness();
    await expect(
      service.createStudent({ collegeId: "col_ghost", admissionNo: "A1", fullName: "X" }),
    ).rejects.toThrow(UnknownReferenceError);
  });

  it("an unenrolled student sits at college level", async () => {
    const { service, org } = await makeHarness();
    const student = await service.createStudent({
      collegeId: org.college.id,
      admissionNo: "A1",
      fullName: "Meera",
    });
    expect(await service.studentOrgPosition(student)).toEqual({ collegeId: org.college.id });
  });

  it("an enrolled student sits at their section's full path", async () => {
    const { service, org } = await makeHarness();
    const student = await service.createStudent({
      collegeId: org.college.id,
      admissionNo: "A1",
      fullName: "Meera",
    });
    await service.enroll({ studentId: student.id, sectionId: org.section.id, academicYear: "2026-27" });
    expect(await service.studentOrgPosition(student)).toEqual({
      collegeId: org.college.id,
      departmentId: org.department.id,
      classId: org.classRow.id,
      sectionId: org.section.id,
    });
  });
});

describe("enroll / transfer", () => {
  it("withdraws the year's live enrollment and creates the new one", async () => {
    const { service, orgRepo, org, repo } = await makeHarness();
    const sectionB = await orgRepo.createSection({ classId: org.classRow.id, name: "B" });
    const student = await service.createStudent({
      collegeId: org.college.id,
      admissionNo: "A1",
      fullName: "Meera",
    });
    const first = await service.enroll({
      studentId: student.id,
      sectionId: org.section.id,
      academicYear: "2026-27",
    });
    const second = await service.enroll({
      studentId: student.id,
      sectionId: sectionB.id,
      academicYear: "2026-27",
    });
    expect(second?.previous?.id).toBe(first?.enrollment.id);
    expect(repo.enrollments.get(first!.enrollment.id)?.status).toBe("withdrawn");
    expect(await service.getActiveEnrollment(student.id, "2026-27")).toMatchObject({
      sectionId: sectionB.id,
    });
  });

  it("keeps different academic years independent", async () => {
    const { service, org } = await makeHarness();
    const student = await service.createStudent({
      collegeId: org.college.id,
      admissionNo: "A1",
      fullName: "Meera",
    });
    await service.enroll({ studentId: student.id, sectionId: org.section.id, academicYear: "2025-26" });
    const next = await service.enroll({
      studentId: student.id,
      sectionId: org.section.id,
      academicYear: "2026-27",
    });
    expect(next?.previous).toBeNull();
  });

  it("rejects unknown sections and cross-college sections", async () => {
    const { service, orgRepo, org } = await makeHarness();
    const student = await service.createStudent({
      collegeId: org.college.id,
      admissionNo: "A1",
      fullName: "Meera",
    });
    await expect(
      service.enroll({ studentId: student.id, sectionId: "sec_ghost", academicYear: "2026-27" }),
    ).rejects.toThrow(UnknownReferenceError);

    const otherCollege = await orgRepo.createCollege({ name: "Other", code: "OT" });
    const otherDept = await orgRepo.createDepartment({ collegeId: otherCollege.id, name: "Arts", code: "ART" });
    const otherClass = await orgRepo.createClass({ departmentId: otherDept.id, name: "BA1", code: "BA1" });
    const otherSection = await orgRepo.createSection({ classId: otherClass.id, name: "A" });
    await expect(
      service.enroll({ studentId: student.id, sectionId: otherSection.id, academicYear: "2026-27" }),
    ).rejects.toThrow(/student's college/);
  });

  it("returns null for an unknown student", async () => {
    const { service, org } = await makeHarness();
    expect(
      await service.enroll({ studentId: "stu_ghost", sectionId: org.section.id, academicYear: "2026-27" }),
    ).toBeNull();
  });
});

describe("teachers", () => {
  it("creates, links and unlinks identity", async () => {
    const { service, org } = await makeHarness();
    const teacher = await service.createTeacher({
      collegeId: org.college.id,
      staffNo: "T1",
      fullName: "Asha",
    });
    expect(teacher.identityUserId).toBeNull();
    const linked = await service.linkTeacherIdentity(teacher.id, "user-9");
    expect(linked?.identityUserId).toBe("user-9");
    const unlinked = await service.linkTeacherIdentity(teacher.id, null);
    expect(unlinked?.identityUserId).toBeNull();
  });
});
