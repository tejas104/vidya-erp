import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type {
  Principal,
  RouteContext,
  ScopeChecker,
  ScopeDecision,
} from "@vidya/platform";
import { createPeopleHandlers, type PeopleHandlerDeps } from "./handlers";
import { OrgService } from "../service/org-service";
import { PeopleService } from "../service/people-service";
import { AssignmentsService } from "../service/assignments-service";
import { ImportService } from "../service/import-service";
import {
  FakeDerivedGrants,
  InMemoryImportsRepo,
  InMemoryOrgRepo,
  InMemoryPeopleRepo,
  MemoryObjectStore,
  RecordingAudit,
  seedOrg,
} from "../../test-support/fakes";

const logger = pino({ level: "silent" });

/** TEST DOUBLE — the real matrix is the human core; here we script decisions. */
class StubScopeChecker implements ScopeChecker {
  decision: ScopeDecision = { granted: true, reason: "stub-allow" };
  readonly calls: { action: string; resource: unknown }[] = [];
  check(_principal: Principal, action: string, resource: unknown): ScopeDecision {
    this.calls.push({ action, resource });
    return this.decision;
  }
}

async function makeHarness() {
  const orgRepo = new InMemoryOrgRepo();
  const peopleRepo = new InMemoryPeopleRepo();
  const importsRepo = new InMemoryImportsRepo();
  const audit = new RecordingAudit();
  const scopeChecker = new StubScopeChecker();
  const identityGrants = new FakeDerivedGrants();
  const org = await seedOrg(orgRepo);
  const enqueued: unknown[] = [];
  const deps: PeopleHandlerDeps = {
    org: new OrgService({ repo: orgRepo, audit }),
    people: new PeopleService({ repo: peopleRepo, orgRepo }),
    assignments: new AssignmentsService({ repo: peopleRepo, orgRepo, identityGrants, audit }),
    imports: new ImportService({
      imports: importsRepo,
      people: peopleRepo,
      orgRepo,
      store: new MemoryObjectStore(),
      audit,
    }),
    scopeChecker,
    storage: { client: {} as PeopleHandlerDeps["storage"]["client"], bucket: "test-bucket" },
    enqueueImport: async (payload) => {
      enqueued.push(payload);
    },
  };
  return {
    handlers: createPeopleHandlers(deps),
    orgRepo,
    peopleRepo,
    scopeChecker,
    org,
    enqueued,
  };
}

const admin: Principal = {
  id: "admin-1",
  kind: "user",
  displayName: "Admin",
  roles: ["admin"],
  scopes: [],
  grants: [{ role: "admin", org: { collegeId: "col-x" } }],
  sessionId: "s",
};

function ctx(input: { body?: unknown; params?: unknown; query?: unknown } = {}): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal: admin,
    request: {
      params: input.params,
      query: input.query,
      body: input.body,
      headers: new Headers(),
    },
  };
}

describe("scope-check chokepoint usage", () => {
  it("denies with 403 before any write when the checker denies", async () => {
    const { handlers, scopeChecker, orgRepo, org } = await makeHarness();
    scopeChecker.decision = { granted: false, reason: "outside scope" };
    const result = await handlers["people.department-create"]!(
      ctx({ body: { collegeId: org.college.id, name: "Arts", code: "ART" } }),
    );
    expect(result.status).toBe(403);
    expect(orgRepo.departments.size).toBe(1); // only the seeded one
  });

  it("positions students by their live enrollment for the check", async () => {
    const { handlers, peopleRepo, scopeChecker, org } = await makeHarness();
    const student = await peopleRepo.createStudent({
      collegeId: org.college.id,
      admissionNo: "A1",
      fullName: "Meera",
    });
    await peopleRepo.createEnrollment({
      studentId: student.id,
      sectionId: org.section.id,
      academicYear: "2026-27",
    });
    await handlers["people.student-get"]!(ctx({ params: { studentId: student.id } }));
    const call = scopeChecker.calls.at(-1) as { resource: { org: Record<string, string> } };
    expect(call.resource.org).toMatchObject({
      collegeId: org.college.id,
      classId: org.classRow.id,
      sectionId: org.section.id,
    });
  });

  it("enrollment transfers scope-check BOTH source and target sections", async () => {
    const { handlers, peopleRepo, orgRepo, scopeChecker, org } = await makeHarness();
    const sectionB = await orgRepo.createSection({ classId: org.classRow.id, name: "B" });
    const student = await peopleRepo.createStudent({
      collegeId: org.college.id,
      admissionNo: "A1",
      fullName: "Meera",
    });
    await peopleRepo.createEnrollment({
      studentId: student.id,
      sectionId: org.section.id,
      academicYear: "2026-27",
    });
    const result = await handlers["people.student-enroll"]!(
      ctx({
        params: { studentId: student.id },
        body: { sectionId: sectionB.id, academicYear: "2026-27" },
      }),
    );
    expect(result.status).toBe(200);
    const checkedOrgs = scopeChecker.calls.map(
      (call) => (call.resource as { org: { sectionId?: string } }).org.sectionId,
    );
    expect(checkedOrgs).toContain(sectionB.id); // target
    expect(checkedOrgs).toContain(org.section.id); // source
  });

  it("teacher reads carry ownerUserId so self-access can apply", async () => {
    const { handlers, peopleRepo, scopeChecker, org } = await makeHarness();
    const teacher = await peopleRepo.createTeacher({
      collegeId: org.college.id,
      staffNo: "T1",
      fullName: "Asha",
    });
    await peopleRepo.updateTeacher(teacher.id, { identityUserId: "user-9" });
    await handlers["people.teacher-get"]!(ctx({ params: { teacherId: teacher.id } }));
    const call = scopeChecker.calls.at(-1) as { resource: { ownerUserId?: string } };
    expect(call.resource.ownerUserId).toBe("user-9");
  });

  it("college-list filters to readable colleges", async () => {
    const { handlers, orgRepo, scopeChecker, org } = await makeHarness();
    const other = await orgRepo.createCollege({ name: "Other", code: "OT" });
    scopeChecker.check = (_principal, _action, resource) => {
      const ref = resource as { org: { collegeId: string } };
      return ref.org.collegeId === org.college.id
        ? { granted: true, reason: "stub" }
        : { granted: false, reason: "stub" };
    };
    const result = await handlers["people.college-list"]!(ctx());
    const body = result.body as { colleges: { id: string }[] };
    expect(body.colleges.map((college) => college.id)).toEqual([org.college.id]);
    expect(body.colleges.map((college) => college.id)).not.toContain(other.id);
  });
});

describe("error mapping", () => {
  it("maps duplicates to 409 and unknown parents to 404", async () => {
    const { handlers, org } = await makeHarness();
    const dup = await handlers["people.department-create"]!(
      ctx({ body: { collegeId: org.college.id, name: "Science 2", code: "SCI" } }),
    );
    expect(dup.status).toBe(409);
    const orphan = await handlers["people.class-create"]!(
      ctx({ body: { departmentId: "dep_ghost", name: "X", code: "X1" } }),
    );
    expect(orphan.status).toBe(404);
  });

  it("maps RESTRICT deletes to 409", async () => {
    const { handlers, org } = await makeHarness();
    const result = await handlers["people.org-delete"]!(
      ctx({ params: { unitType: "college", unitId: org.college.id } }),
    );
    expect(result.status).toBe(409);
  });

  it("deletes an empty unit and audits", async () => {
    const { handlers, org } = await makeHarness();
    const result = await handlers["people.org-delete"]!(
      ctx({ params: { unitType: "section", unitId: org.section.id } }),
    );
    expect(result.status).toBe(200);
    expect(result.audit?.resourceId).toBe(org.section.id);
  });
});

describe("org administration handlers", () => {
  it("builds the full tree via handlers and reads it back", async () => {
    const { handlers, org } = await makeHarness();
    const classResponse = await handlers["people.class-create"]!(
      ctx({ body: { departmentId: org.department.id, name: "BSc Year 2", code: "BSC2" } }),
    );
    expect(classResponse.status).toBe(201);
    const classId = (classResponse.body as { id: string }).id;
    const section = await handlers["people.section-create"]!(
      ctx({ body: { classId, name: "A" } }),
    );
    expect(section.status).toBe(201);
    const sectionDup = await handlers["people.section-create"]!(
      ctx({ body: { classId, name: "A" } }),
    );
    expect(sectionDup.status).toBe(409);
    const subject = await handlers["people.subject-create"]!(
      ctx({ body: { departmentId: org.department.id, name: "Physics", code: "PHY" } }),
    );
    expect(subject.status).toBe(201);
    const subjectOrphan = await handlers["people.subject-create"]!(
      ctx({ body: { departmentId: "dep_ghost", name: "X", code: "X" } }),
    );
    expect(subjectOrphan.status).toBe(404);
    const sectionOrphan = await handlers["people.section-create"]!(
      ctx({ body: { classId: "cls_ghost", name: "A" } }),
    );
    expect(sectionOrphan.status).toBe(404);

    const tree = await handlers["people.college-tree"]!(
      ctx({ params: { collegeId: org.college.id } }),
    );
    expect(tree.status).toBe(200);
    const body = tree.body as { departments: { classes: unknown[]; subjects: unknown[] }[] };
    expect(body.departments[0]?.classes).toHaveLength(2);
    expect(body.departments[0]?.subjects).toHaveLength(2);
    expect(
      (await handlers["people.college-tree"]!(ctx({ params: { collegeId: "col_ghost" } }))).status,
    ).toBe(404);
  });

  it("renames units and 404s unknown ones", async () => {
    const { handlers, orgRepo, org } = await makeHarness();
    const renamed = await handlers["people.org-rename"]!(
      ctx({ params: { unitType: "class", unitId: org.classRow.id }, body: { name: "Renamed" } }),
    );
    expect(renamed.status).toBe(200);
    expect(orgRepo.classes.get(org.classRow.id)?.name).toBe("Renamed");
    expect(
      (
        await handlers["people.org-rename"]!(
          ctx({ params: { unitType: "class", unitId: "cls_ghost" }, body: { name: "X" } }),
        )
      ).status,
    ).toBe(404);
  });
});

describe("student handlers", () => {
  it("creates, reads, updates; duplicates 409; unknowns 404", async () => {
    const { handlers, org } = await makeHarness();
    const created = await handlers["people.student-create"]!(
      ctx({ body: { collegeId: org.college.id, admissionNo: "A1", fullName: "Meera" } }),
    );
    expect(created.status).toBe(201);
    const studentId = (created.body as { id: string }).id;
    expect(
      (
        await handlers["people.student-create"]!(
          ctx({ body: { collegeId: org.college.id, admissionNo: "A1", fullName: "Dup" } }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await handlers["people.student-create"]!(
          ctx({ body: { collegeId: "col_ghost", admissionNo: "A2", fullName: "X" } }),
        )
      ).status,
    ).toBe(404);

    const read = await handlers["people.student-get"]!(ctx({ params: { studentId } }));
    expect(read.status).toBe(200);
    expect((read.body as { enrollment: unknown }).enrollment).toBeNull();
    expect(
      (await handlers["people.student-get"]!(ctx({ params: { studentId: "stu_ghost" } }))).status,
    ).toBe(404);

    const updated = await handlers["people.student-update"]!(
      ctx({ params: { studentId }, body: { status: "inactive" } }),
    );
    expect(updated.status).toBe(200);
    expect(updated.audit?.details).toMatchObject({
      before: expect.objectContaining({ status: "active" }),
      after: expect.objectContaining({ status: "inactive" }),
    });
    expect(
      (
        await handlers["people.student-update"]!(
          ctx({ params: { studentId: "stu_ghost" }, body: { status: "active" } }),
        )
      ).status,
    ).toBe(404);
  });

  it("enroll 404s unknown students and sections; roster 404s unknown sections", async () => {
    const { handlers, org } = await makeHarness();
    expect(
      (
        await handlers["people.student-enroll"]!(
          ctx({
            params: { studentId: "stu_ghost" },
            body: { sectionId: org.section.id, academicYear: "2026-27" },
          }),
        )
      ).status,
    ).toBe(404);
    const student = await handlers["people.student-create"]!(
      ctx({ body: { collegeId: org.college.id, admissionNo: "A9", fullName: "X" } }),
    );
    expect(
      (
        await handlers["people.student-enroll"]!(
          ctx({
            params: { studentId: (student.body as { id: string }).id },
            body: { sectionId: "sec_ghost", academicYear: "2026-27" },
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await handlers["people.section-roster"]!(ctx({ params: { sectionId: "sec_ghost" } })))
        .status,
    ).toBe(404);
    const roster = await handlers["people.section-roster"]!(
      ctx({ params: { sectionId: org.section.id } }),
    );
    expect(roster.status).toBe(200);
  });
});

describe("teacher & assignment handlers", () => {
  async function makeTeacher(harness: Awaited<ReturnType<typeof makeHarness>>) {
    const created = await harness.handlers["people.teacher-create"]!(
      ctx({ body: { collegeId: harness.org.college.id, staffNo: "T1", fullName: "Asha" } }),
    );
    expect(created.status).toBe(201);
    return (created.body as { id: string }).id;
  }

  it("creates teachers (409 on duplicates, 404 unknown college) and reads them", async () => {
    const harness = await makeHarness();
    const teacherId = await makeTeacher(harness);
    expect(
      (
        await harness.handlers["people.teacher-create"]!(
          ctx({ body: { collegeId: harness.org.college.id, staffNo: "T1", fullName: "Dup" } }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await harness.handlers["people.teacher-create"]!(
          ctx({ body: { collegeId: "col_ghost", staffNo: "T2", fullName: "X" } }),
        )
      ).status,
    ).toBe(404);
    const read = await harness.handlers["people.teacher-get"]!(ctx({ params: { teacherId } }));
    expect(read.status).toBe(200);
    expect(
      (await harness.handlers["people.teacher-get"]!(ctx({ params: { teacherId: "tch_ghost" } })))
        .status,
    ).toBe(404);
  });

  it("link-identity syncs grants; status changes re-sync; rename does not", async () => {
    const harness = await makeHarness();
    const teacherId = await makeTeacher(harness);
    await harness.handlers["people.assignment-create"]!(
      ctx({
        params: { teacherId },
        body: {
          classId: harness.org.classRow.id,
          subjectId: harness.org.subject.id,
          kind: "subject_teacher",
          academicYear: "2026-27",
        },
      }),
    );
    const linked = await harness.handlers["people.teacher-link-identity"]!(
      ctx({ params: { teacherId }, body: { identityUserId: "user-9" } }),
    );
    expect(linked.status).toBe(200);
    expect((linked.body as { grants: { upserted: number } }).grants.upserted).toBe(1);

    const renamed = await harness.handlers["people.teacher-update"]!(
      ctx({ params: { teacherId }, body: { fullName: "Asha V." } }),
    );
    expect((renamed.audit?.details as { grants: { removed: number } }).grants).toEqual({
      upserted: 0,
      removed: 0,
    });

    const deactivated = await harness.handlers["people.teacher-update"]!(
      ctx({ params: { teacherId }, body: { status: "inactive" } }),
    );
    expect((deactivated.audit?.details as { grants: { removed: number } }).grants.removed).toBe(1);
    expect(
      (
        await harness.handlers["people.teacher-update"]!(
          ctx({ params: { teacherId: "tch_ghost" }, body: { status: "active" } }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await harness.handlers["people.teacher-link-identity"]!(
          ctx({ params: { teacherId: "tch_ghost" }, body: { identityUserId: "u" } }),
        )
      ).status,
    ).toBe(404);
  });

  it("assignment create/list/remove flows with 404s and 409s", async () => {
    const harness = await makeHarness();
    const teacherId = await makeTeacher(harness);
    const created = await harness.handlers["people.assignment-create"]!(
      ctx({
        params: { teacherId },
        body: {
          classId: harness.org.classRow.id,
          subjectId: harness.org.subject.id,
          kind: "subject_teacher",
          academicYear: "2026-27",
        },
      }),
    );
    expect(created.status).toBe(201);
    const assignmentId = (created.body as { id: string }).id;

    expect(
      (
        await harness.handlers["people.assignment-create"]!(
          ctx({
            params: { teacherId },
            body: {
              classId: harness.org.classRow.id,
              subjectId: harness.org.subject.id,
              kind: "subject_teacher",
              academicYear: "2026-27",
            },
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await harness.handlers["people.assignment-create"]!(
          ctx({
            params: { teacherId: "tch_ghost" },
            body: {
              classId: harness.org.classRow.id,
              subjectId: harness.org.subject.id,
              kind: "subject_teacher",
              academicYear: "2026-27",
            },
          }),
        )
      ).status,
    ).toBe(404);

    // A second teacher as class_teacher (no subject) — covers the null-subject case.
    const secondTeacherCreated = await harness.handlers["people.teacher-create"]!(
      ctx({ body: { collegeId: harness.org.college.id, staffNo: "T2", fullName: "Devika" } }),
    );
    expect(secondTeacherCreated.status).toBe(201);
    const secondTeacherId = (secondTeacherCreated.body as { id: string }).id;
    const classTeacherCreated = await harness.handlers["people.assignment-create"]!(
      ctx({
        params: { teacherId: secondTeacherId },
        body: { classId: harness.org.classRow.id, kind: "class_teacher", academicYear: "2026-27" },
      }),
    );
    expect(classTeacherCreated.status).toBe(201);
    expect((classTeacherCreated.body as { teacherName: string | null }).teacherName).toBe("Devika");
    expect((classTeacherCreated.body as { subjectName: string | null }).subjectName).toBeNull();

    const listing = await harness.handlers["people.class-assignments"]!(
      ctx({ params: { classId: harness.org.classRow.id } }),
    );
    expect(listing.status).toBe(200);
    const assignmentsList = (listing.body as {
      assignments: { teacherId: string; kind: string; teacherName: string | null; subjectName: string | null }[];
    }).assignments;
    expect(assignmentsList).toHaveLength(2);
    const subjectTeacherRow = assignmentsList.find((a) => a.kind === "subject_teacher")!;
    expect(subjectTeacherRow.teacherName).toBe("Asha");
    expect(subjectTeacherRow.subjectName).toBe("Mathematics");
    const classTeacherRow = assignmentsList.find((a) => a.kind === "class_teacher")!;
    expect(classTeacherRow.teacherName).toBe("Devika");
    expect(classTeacherRow.subjectName).toBeNull();
    expect(
      (
        await harness.handlers["people.class-assignments"]!(
          ctx({ params: { classId: "cls_ghost" } }),
        )
      ).status,
    ).toBe(404);

    expect(
      (
        await harness.handlers["people.assignment-remove"]!(
          ctx({ params: { assignmentId } }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await harness.handlers["people.assignment-remove"]!(
          ctx({ params: { assignmentId: "asg_ghost" } }),
        )
      ).status,
    ).toBe(404);
  });
});

describe("imports", () => {
  it("404s unknown colleges and unknown imports", async () => {
    const { handlers } = await makeHarness();
    expect(
      (
        await handlers["people.import-create"]!(
          ctx({
            body: { kind: "teachers", collegeId: "col_ghost", dryRun: true, csv: "staff_no,full_name\nT1,X" },
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await handlers["people.import-get"]!(ctx({ params: { importId: "imp_ghost" } }))).status,
    ).toBe(404);
  });
  it("accepts, stores and enqueues; then reports state", async () => {
    const { handlers, enqueued, org } = await makeHarness();
    const accepted = await handlers["people.import-create"]!(
      ctx({
        body: {
          kind: "teachers",
          collegeId: org.college.id,
          dryRun: true,
          csv: "staff_no,full_name\nT1,Asha",
        },
      }),
    );
    expect(accepted.status).toBe(202);
    const importId = (accepted.body as { importId: string }).importId;
    expect(enqueued).toEqual([{ importId, source: "api" }]);

    const state = await handlers["people.import-get"]!(ctx({ params: { importId } }));
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ id: importId, status: "pending", dryRun: true });
  });
});
