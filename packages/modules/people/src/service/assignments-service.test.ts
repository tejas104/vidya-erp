import { describe, expect, it } from "vitest";
import { AssignmentsService, sourceRefFor } from "./assignments-service";
import { UnknownReferenceError } from "./people-service";
import {
  FakeDerivedGrants,
  InMemoryOrgRepo,
  InMemoryPeopleRepo,
  RecordingAudit,
  seedOrg,
} from "../../test-support/fakes";

async function makeHarness() {
  const orgRepo = new InMemoryOrgRepo();
  const repo = new InMemoryPeopleRepo();
  const identityGrants = new FakeDerivedGrants();
  const audit = new RecordingAudit();
  const org = await seedOrg(orgRepo);
  const service = new AssignmentsService({ repo, orgRepo, identityGrants, audit });
  const teacher = await repo.createTeacher({
    collegeId: org.college.id,
    staffNo: "T1",
    fullName: "Asha",
  });
  return { service, repo, orgRepo, identityGrants, audit, org, teacher };
}

describe("assignment → derived grant (ADR-0015)", () => {
  it("derives a class-level teacher grant for a linked subject teacher", async () => {
    const { service, repo, identityGrants, org, teacher } = await makeHarness();
    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    const assignment = await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    const grant = identityGrants.bySourceRef.get(sourceRefFor(assignment!.id));
    expect(grant).toEqual({
      userId: "user-9",
      role: "teacher",
      org: {
        collegeId: org.college.id,
        departmentId: org.department.id,
        classId: org.classRow.id,
      },
      subjectId: org.subject.id,
      sourceRef: sourceRefFor(assignment!.id),
    });
    // Class-level per the approved policy: no sectionId, ever.
    expect(grant?.org).not.toHaveProperty("sectionId");
  });

  it("derives a class_teacher grant without a subject", async () => {
    const { service, repo, identityGrants, org, teacher } = await makeHarness();
    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    const assignment = await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      kind: "class_teacher",
      academicYear: "2026-27",
    });
    const grant = identityGrants.bySourceRef.get(sourceRefFor(assignment!.id));
    expect(grant?.role).toBe("class_teacher");
    expect(grant?.subjectId).toBeUndefined();
  });

  it("creates no grant for an unlinked teacher (derivation waits for the link)", async () => {
    const { service, identityGrants, org, teacher } = await makeHarness();
    const assignment = await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    expect(assignment).not.toBeNull();
    expect(identityGrants.bySourceRef.size).toBe(0);
  });

  it("COMPENSATES: a failed grant call rolls the assignment row back", async () => {
    const { service, repo, identityGrants, org, teacher } = await makeHarness();
    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    identityGrants.failNextUpsert = true;
    await expect(
      service.create({
        teacherId: teacher.id,
        classId: org.classRow.id,
        subjectId: org.subject.id,
        kind: "subject_teacher",
        academicYear: "2026-27",
      }),
    ).rejects.toThrow(/identity unavailable/);
    expect(repo.assignments.size).toBe(0);
    expect(identityGrants.bySourceRef.size).toBe(0);
  });

  it("validates class and subject references before writing", async () => {
    const { service, org, teacher } = await makeHarness();
    await expect(
      service.create({
        teacherId: teacher.id,
        classId: "cls_ghost",
        subjectId: org.subject.id,
        kind: "subject_teacher",
        academicYear: "2026-27",
      }),
    ).rejects.toThrow(UnknownReferenceError);
    await expect(
      service.create({
        teacherId: teacher.id,
        classId: org.classRow.id,
        subjectId: "sub_ghost",
        kind: "subject_teacher",
        academicYear: "2026-27",
      }),
    ).rejects.toThrow(UnknownReferenceError);
    expect(await service.create({
      teacherId: "tch_ghost",
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    })).toBeNull();
  });

  it("removal takes the grant down first, then the row", async () => {
    const { service, repo, identityGrants, org, teacher } = await makeHarness();
    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    const assignment = await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    expect(await service.remove(assignment!.id)).toBe(true);
    expect(identityGrants.bySourceRef.size).toBe(0);
    expect(repo.assignments.size).toBe(0);
    expect(await service.remove("asg_ghost")).toBe(false);
  });
});

describe("syncTeacher (link / unlink / deactivate)", () => {
  it("linking derives grants for existing assignments; unlinking removes them", async () => {
    const { service, repo, identityGrants, org, teacher } = await makeHarness();
    await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    expect(identityGrants.bySourceRef.size).toBe(0);

    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    expect(await service.syncTeacher(teacher.id)).toEqual({ upserted: 1, removed: 0 });
    expect(identityGrants.bySourceRef.size).toBe(1);

    await repo.updateTeacher(teacher.id, { identityUserId: null });
    expect(await service.syncTeacher(teacher.id)).toEqual({ upserted: 0, removed: 1 });
    expect(identityGrants.bySourceRef.size).toBe(0);
  });

  it("deactivation removes grants even while linked", async () => {
    const { service, repo, identityGrants, org, teacher } = await makeHarness();
    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    await repo.updateTeacher(teacher.id, { status: "inactive" });
    expect(await service.syncTeacher(teacher.id)).toEqual({ upserted: 0, removed: 1 });
    expect(identityGrants.bySourceRef.size).toBe(0);
  });

  it("is a no-op for unknown teachers", async () => {
    const { service } = await makeHarness();
    expect(await service.syncTeacher("tch_ghost")).toEqual({ upserted: 0, removed: 0 });
  });
});

describe("passthrough reads & degenerate org paths", () => {
  it("exposes getAssignment and assignmentsByClass", async () => {
    const { service, org, teacher } = await makeHarness();
    const created = await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    expect(await service.getAssignment(created!.id)).toMatchObject({ id: created!.id });
    expect(await service.assignmentsByClass(org.classRow.id)).toHaveLength(1);
    expect(await service.getAssignment("asg_ghost")).toBeNull();
  });

  it("treats an unresolvable class path as no-grant-desired (removed on sync)", async () => {
    const { service, repo, orgRepo, identityGrants, org, teacher } = await makeHarness();
    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    expect(identityGrants.bySourceRef.size).toBe(1);
    // The class vanishes underneath the assignment (data surgery / partial restore).
    orgRepo.classes.delete(org.classRow.id);
    expect(await service.syncTeacher(teacher.id)).toEqual({ upserted: 0, removed: 1 });
    expect(identityGrants.bySourceRef.size).toBe(0);
  });

  it("upsert replaces the grant when the class changes (same sourceRef)", async () => {
    const { service, repo, orgRepo, identityGrants, org, teacher } = await makeHarness();
    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    const otherClass = await orgRepo.createClass({
      departmentId: org.department.id,
      name: "Y2",
      code: "Y2",
    });
    const created = await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    // Simulate a repo-level class move, then re-sync.
    repo.assignments.set(created!.id, { ...created!, classId: otherClass.id });
    expect(await service.syncTeacher(teacher.id)).toEqual({ upserted: 1, removed: 0 });
    expect(identityGrants.bySourceRef.get(sourceRefFor(created!.id))?.org.classId).toBe(
      otherClass.id,
    );
  });
});

describe("reconcile (the safety net)", () => {
  it("recreates missing grants, removes orphans, audits repairs", async () => {
    const { service, repo, identityGrants, audit, org, teacher } = await makeHarness();
    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    const assignment = await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    // Simulate drift: the derived grant vanished, and an orphan appeared.
    identityGrants.bySourceRef.delete(sourceRefFor(assignment!.id));
    identityGrants.bySourceRef.set("people:assignment:ghost", {
      userId: "user-0",
      role: "teacher",
      org: { collegeId: org.college.id, departmentId: org.department.id, classId: org.classRow.id },
      subjectId: org.subject.id,
      sourceRef: "people:assignment:ghost",
    });

    const result = await service.reconcile();
    expect(result).toEqual({ upserted: 1, removed: 1 });
    expect(identityGrants.bySourceRef.has(sourceRefFor(assignment!.id))).toBe(true);
    expect(identityGrants.bySourceRef.has("people:assignment:ghost")).toBe(false);
    expect(audit.actions()).toContain("people.grant-reconcile-repaired");
  });

  it("a clean pass repairs nothing and stays silent", async () => {
    const { service, repo, audit, org, teacher } = await makeHarness();
    await repo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    await service.create({
      teacherId: teacher.id,
      classId: org.classRow.id,
      subjectId: org.subject.id,
      kind: "subject_teacher",
      academicYear: "2026-27",
    });
    const auditCountBefore = audit.events.length;
    expect(await service.reconcile()).toEqual({ upserted: 0, removed: 0 });
    expect(audit.events.length).toBe(auditCountBefore);
  });
});
