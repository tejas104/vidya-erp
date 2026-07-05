import { describe, expect, it } from "vitest";
import { OrgService } from "./org-service";
import { InMemoryOrgRepo, RecordingAudit, seedOrg } from "../../test-support/fakes";

function makeService() {
  const repo = new InMemoryOrgRepo();
  const audit = new RecordingAudit();
  return { repo, audit, service: new OrgService({ repo, audit }) };
}

describe("OrgDirectory implementation (#2 contract)", () => {
  it("accepts every level of a correctly nested path", async () => {
    const { repo, service } = makeService();
    const { college, department, classRow, section } = await seedOrg(repo);
    expect((await service.orgDirectory.verifyOrgPath({ collegeId: college.id })).valid).toBe(true);
    expect(
      (await service.orgDirectory.verifyOrgPath({ collegeId: college.id, departmentId: department.id })).valid,
    ).toBe(true);
    expect(
      (
        await service.orgDirectory.verifyOrgPath({
          collegeId: college.id,
          departmentId: department.id,
          classId: classRow.id,
          sectionId: section.id,
        })
      ).valid,
    ).toBe(true);
  });

  it("rejects unknown units with reasons", async () => {
    const { repo, service } = makeService();
    const { college, department } = await seedOrg(repo);
    const unknownCollege = await service.orgDirectory.verifyOrgPath({ collegeId: "col_ghost" });
    expect(unknownCollege).toMatchObject({ valid: false });
    const unknownDept = await service.orgDirectory.verifyOrgPath({
      collegeId: college.id,
      departmentId: "dep_ghost",
    });
    expect(unknownDept.valid).toBe(false);
    expect(unknownDept.reason).toContain("dep_ghost");
    const unknownClass = await service.orgDirectory.verifyOrgPath({
      collegeId: college.id,
      departmentId: department.id,
      classId: "cls_ghost",
    });
    expect(unknownClass.valid).toBe(false);
  });

  it("rejects mis-nested paths (existence is not enough)", async () => {
    const { repo, service } = makeService();
    const { college, classRow } = await seedOrg(repo);
    const otherCollege = await repo.createCollege({ name: "Other", code: "OT" });
    const otherDept = await repo.createDepartment({ collegeId: otherCollege.id, name: "Arts", code: "ART" });
    // Real department, wrong college.
    expect(
      (await service.orgDirectory.verifyOrgPath({ collegeId: college.id, departmentId: otherDept.id })).valid,
    ).toBe(false);
    // Real class under a department it does not belong to.
    expect(
      (
        await service.orgDirectory.verifyOrgPath({
          collegeId: otherCollege.id,
          departmentId: otherDept.id,
          classId: classRow.id,
        })
      ).valid,
    ).toBe(false);
  });

  it("rejects skipped levels (classId without departmentId)", async () => {
    const { repo, service } = makeService();
    const { college, classRow } = await seedOrg(repo);
    const result = await service.orgDirectory.verifyOrgPath({
      collegeId: college.id,
      classId: classRow.id,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("departmentId");
  });

  it("verifies subject ids", async () => {
    const { repo, service } = makeService();
    const { subject } = await seedOrg(repo);
    expect(await service.orgDirectory.verifySubjectId(subject.id)).toBe(true);
    expect(await service.orgDirectory.verifySubjectId("sub_ghost")).toBe(false);
  });
});

describe("pathForUnit", () => {
  it("resolves each unit type to its full path", async () => {
    const { repo, service } = makeService();
    const { college, department, classRow, section, subject } = await seedOrg(repo);
    expect(await service.pathForUnit("college", college.id)).toEqual({ collegeId: college.id });
    expect(await service.pathForUnit("section", section.id)).toEqual({
      collegeId: college.id,
      departmentId: department.id,
      classId: classRow.id,
      sectionId: section.id,
    });
    // Subjects live at their department's position.
    expect(await service.pathForUnit("subject", subject.id)).toEqual({
      collegeId: college.id,
      departmentId: department.id,
    });
    expect(await service.pathForUnit("class", "cls_ghost")).toBeNull();
  });
});

describe("bootstrapCollege", () => {
  it("creates once (audited as system), then returns the existing college", async () => {
    const { service, audit } = makeService();
    const first = await service.bootstrapCollege({ name: "Main", code: "MAIN" });
    expect(first.created).toBe(true);
    expect(audit.actions()).toEqual(["people.college-bootstrapped"]);
    const second = await service.bootstrapCollege({ name: "Main", code: "MAIN" });
    expect(second).toEqual({ collegeId: first.collegeId, created: false });
    expect(audit.events).toHaveLength(1);
  });
});
