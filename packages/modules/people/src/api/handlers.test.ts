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
import { ProgressionService } from "../service/progression-service";
import type { ProgressionApplyInput } from "../repo/progression-repo";
import { issueDurableAuditReceipt } from "@vidya/platform";
import { ImportService, type CredentialIssuer } from "../service/import-service";
import { UsernameTakenError } from "@vidya/module-identity";
import { usernameFromCode } from "../ids";
import {
  FakeDerivedGrants,
  InMemoryImportsRepo,
  InMemoryOrgRepo,
  InMemoryPeopleRepo,
  InMemoryStaffAttendanceRepo,
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

/** Deterministic — assigns a fresh, unique fake identity user id per call. */
function fakeIdentity(): CredentialIssuer {
  let n = 0;
  return {
    issueCredential: async (input) => {
      n += 1;
      return { userId: `idn_fake_${n}`, username: input.username, temporaryPassword: "Fak3Pass!123" };
    },
  };
}

async function makeHarness(opts: { identity?: CredentialIssuer; edition?: "college" | "school"; accountForLink?: (userId: string) => Promise<{ collegeId: string; accountKind: "staff" | "guardian"; roles: readonly string[] } | null> } = {}) {
  const orgRepo = new InMemoryOrgRepo();
  const peopleRepo = new InMemoryPeopleRepo();
  const staffAttendance = new InMemoryStaffAttendanceRepo(peopleRepo);
  const importsRepo = new InMemoryImportsRepo();
  const audit = new RecordingAudit();
  const scopeChecker = new StubScopeChecker();
  const identityGrants = new FakeDerivedGrants();
  const identity = opts.identity ?? fakeIdentity();
  const org = await seedOrg(orgRepo);
  const enqueued: unknown[] = [];
  const applied: ProgressionApplyInput[] = [];
  const deps: PeopleHandlerDeps = {
    org: new OrgService({ repo: orgRepo, audit }),
    people: new PeopleService({ repo: peopleRepo, orgRepo }),
    staffAttendance,
    assignments: new AssignmentsService({ repo: peopleRepo, orgRepo, identityGrants, audit }),
    // The transaction itself is exercised against Postgres (tests/integration/progression.int.test.ts);
    // here the fake records what the service asked the repo to write.
    progression: new ProgressionService({
      people: peopleRepo,
      org: orgRepo,
      relationships: async () => [{ status: "active", validUntil: null }],
      today: () => "2027-04-10",
      repo: {
        getHistoryPolicy: async () => ({ days: 90, version: 1 }),
        updateHistoryPolicy: async (input) => ({
          policy: { days: input.days, version: input.expectedVersion + 1 },
          receipt: issueDurableAuditReceipt({ module: "people", action: "people.guardian-history-policy-updated", actorType: "user", actorId: input.attribution.actorId, resourceType: "college", resourceId: input.collegeId, requestId: input.attribution.requestId, details: {} }),
        }),
        reverse: async (input) => ({
          correctionId: "prc_test",
          reinstatedEnrollmentId: "enr_reinstated",
          receipt: issueDurableAuditReceipt({ module: "people", action: "people.progression-reversed", actorType: "user", actorId: input.attribution.actorId, resourceType: "student", resourceId: input.studentId, requestId: input.attribution.requestId, details: {} }),
        }),
        apply: async (input) => {
          applied.push(input);
          return {
            runId: "prg_test",
            pupils: [],
            receipt: issueDurableAuditReceipt({ module: "people", action: "people.progression-applied", actorType: "user", actorId: input.attribution.actorId, resourceType: "progression-run", resourceId: "prg_test", requestId: input.attribution.requestId, details: {} }),
          };
        },
      },
    }),
    imports: new ImportService({
      imports: importsRepo,
      people: peopleRepo,
      orgRepo,
      edition: opts.edition ?? "college",
      store: new MemoryObjectStore(),
      audit,
    }),
    scopeChecker,
    storage: { client: {} as PeopleHandlerDeps["storage"]["client"], bucket: "test-bucket" },
    enqueueImport: async (payload) => {
      enqueued.push(payload);
    },
    edition: opts.edition ?? "college",
    identity: { ...identity, accountForLink: opts.accountForLink ?? (async () => ({ collegeId: org.college.id, accountKind: "staff", roles: ["teacher"] })) },
    readAudit: async () => [],
  };
  return {
    handlers: createPeopleHandlers(deps),
    orgRepo,
    peopleRepo,
    staffAttendance,
    importsRepo,
    scopeChecker,
    org,
    enqueued,
    identity,
    applied,
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

async function makeTeacher(harness: Awaited<ReturnType<typeof makeHarness>>) {
  const created = await harness.handlers["people.teacher-create"]!(
    ctx({ body: { collegeId: harness.org.college.id, staffNo: "T1", fullName: "Asha" } }),
  );
  expect(created.status).toBe(201);
  return (created.body as { id: string }).id;
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
  it("records and corrects dated staff presence with scope and audit boundaries", async () => {
    const harness = await makeHarness({ edition: "school" });
    const collegeId = harness.org.college.id;
    const first = await harness.peopleRepo.createTeacher({ collegeId, staffNo: "T10", fullName: "Asha" });
    const second = await harness.peopleRepo.createTeacher({ collegeId, staffNo: "T11", fullName: "Meera" });
    const foreign = await harness.peopleRepo.createTeacher({ collegeId: "col_else", staffNo: "T12", fullName: "Outside" });
    const date = "2026-09-25";
    const body = { collegeId, date, entries: [
      { teacherId: first.id, status: "present" as const },
      { teacherId: second.id, status: "late" as const, note: "Arrived after assembly" },
    ] };
    const save = await harness.handlers["people.teacher-attendance-save"]!(ctx({ body }));
    expect(save.status).toBe(200);
    expect(save.audit?.details).toMatchObject({ changes: [
      { teacherId: first.id, before: null, after: "present" },
      { teacherId: second.id, before: null, after: "late" },
    ] });
    const list = await harness.handlers["people.teacher-attendance-list"]!(ctx({ query: { collegeId, date, offset: 0, limit: 50 } }));
    expect(list.status).toBe(200);
    const principalRead = await harness.handlers["people.teacher-attendance-list"]!({
      ...ctx({ query: { collegeId, date, offset: 0, limit: 50 } }),
      principal: { ...admin, roles: ["principal"] as Principal["roles"] },
    });
    expect(principalRead.status).toBe(200);
    const teachers = (list.body as { teachers: { teacher: { id: string }; attendance: { status: string; note: string | null } | null }[] }).teachers;
    expect(teachers.find((row) => row.teacher.id === second.id)?.attendance).toMatchObject({ status: "late", note: "Arrived after assembly" });
    const corrected = await harness.handlers["people.teacher-attendance-save"]!(ctx({ body: { collegeId, date, entries: [{ teacherId: first.id, status: "absent" }] } }));
    expect(corrected.audit?.details).toMatchObject({ changes: [{ teacherId: first.id, before: "present", after: "absent" }] });
    expect(harness.staffAttendance.rows.size).toBe(2);
    const bad = await harness.handlers["people.teacher-attendance-save"]!(ctx({ body: { collegeId, date, entries: [
      { teacherId: first.id, status: "leave" }, { teacherId: foreign.id, status: "present" },
    ] } }));
    expect(bad.status).toBe(404);
    expect(harness.staffAttendance.rows.get(`${first.id}:${date}`)?.status).toBe("absent");
    const nonAdmin = { ...ctx({ body }), principal: { ...admin, roles: ["teacher"] as Principal["roles"] } };
    expect((await harness.handlers["people.teacher-attendance-save"]!(nonAdmin)).status).toBe(403);
    expect((await harness.handlers["people.teacher-attendance-save"]!({ ...ctx({ body }), principal: { ...admin, roles: ["principal"] as Principal["roles"] } })).status).toBe(403);
    harness.scopeChecker.decision = { granted: false, reason: "other school" };
    expect((await harness.handlers["people.teacher-attendance-list"]!(ctx({ query: { collegeId, date, offset: 0, limit: 50 } }))).status).toBe(403);
  });
  it("lists only scoped teachers with search and pagination", async () => {
    const harness = await makeHarness();
    const collegeId = harness.org.college.id;
    await harness.peopleRepo.createTeacher({ collegeId, staffNo: "T02", fullName: "Meera Shah" });
    await harness.peopleRepo.createTeacher({ collegeId, staffNo: "T01", fullName: "Asha Rao" });
    await harness.peopleRepo.createTeacher({ collegeId: "col_other", staffNo: "T00", fullName: "Other Teacher" });
    const first = await harness.handlers["people.teacher-list"]!(ctx({ query: { collegeId, offset: 0, limit: 1 } }));
    expect(first.status).toBe(200);
    expect((first.body as { teachers: { staffNo: string }[]; nextOffset: number }).teachers.map((row) => row.staffNo)).toEqual(["T01"]);
    expect((first.body as { nextOffset: number }).nextOffset).toBe(1);
    const searched = await harness.handlers["people.teacher-list"]!(ctx({ query: { collegeId, q: "meera", offset: 0, limit: 50 } }));
    expect((searched.body as { teachers: { staffNo: string }[] }).teachers.map((row) => row.staffNo)).toEqual(["T02"]);
    expect(harness.scopeChecker.calls.at(-1)?.resource).toMatchObject({ org: { collegeId } });
    harness.scopeChecker.decision = { granted: false, reason: "denied" };
    expect((await harness.handlers["people.teacher-list"]!(ctx({ query: { collegeId, offset: 0, limit: 50 } }))).status).toBe(403);
  });

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

  it("rejects guardian and other-school accounts when linking a teacher", async () => {
    const guardian = await makeHarness({ accountForLink: async () => ({ collegeId: "other", accountKind: "guardian", roles: [] }) });
    const teacherId = await makeTeacher(guardian);
    const result = await guardian.handlers["people.teacher-link-identity"]!(ctx({ params: { teacherId }, body: { identityUserId: "user-foreign" } }));
    expect(result.status).toBe(422);
    expect((await guardian.peopleRepo.getTeacher(teacherId))?.identityUserId).toBeNull();
  });

  it("allows an unassigned staff login and rejects a student login", async () => {
    let collegeId = "";
    const harness = await makeHarness({ accountForLink: async (userId) => ({ collegeId, accountKind: "staff", roles: userId === "student" ? ["student"] : [] }) });
    collegeId = harness.org.college.id;
    const teacherId = await makeTeacher(harness);
    expect((await harness.handlers["people.teacher-link-identity"]!(ctx({ params: { teacherId }, body: { identityUserId: "staff-unassigned" } }))).status).toBe(200);
    expect((await harness.handlers["people.teacher-link-identity"]!(ctx({ params: { teacherId }, body: { identityUserId: "student" } }))).status).toBe(422);
  });

  it("does not link one sign-in to two teacher records", async () => {
    const harness = await makeHarness();
    const first = await makeTeacher(harness);
    const second = await harness.peopleRepo.createTeacher({ collegeId: harness.org.college.id, staffNo: "T2", fullName: "Meera" });
    expect((await harness.handlers["people.teacher-link-identity"]!(ctx({ params: { teacherId: first }, body: { identityUserId: "user-9" } }))).status).toBe(200);
    expect((await harness.handlers["people.teacher-link-identity"]!(ctx({ params: { teacherId: second.id }, body: { identityUserId: "user-9" } }))).status).toBe(409);
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

describe("teacher-issue-credential handler (#11 B4, mirrors teacher-link-identity)", () => {
  it("201s a teacher without a login: issues credentials, links identity, syncs grants, and never audits the plaintext password", async () => {
    const harness = await makeHarness();
    const teacherId = await makeTeacher(harness);

    const result = await harness.handlers["people.teacher-issue-credential"]!(
      ctx({ params: { teacherId } }),
    );

    expect(result.status).toBe(201);
    const body = result.body as {
      teacher: { id: string; identityUserId: string | null };
      username: string;
      temporaryPassword: string;
      grants: unknown;
    };
    expect(body.teacher.id).toBe(teacherId);
    expect(body.teacher.identityUserId).toBe("idn_fake_1");
    expect(body.username).toBe(usernameFromCode("T1"));
    expect(body.temporaryPassword).toBe("Fak3Pass!123");

    // The identity link actually landed on the teacher row, not just the response.
    const stored = await harness.peopleRepo.getTeacher(teacherId);
    expect(stored?.identityUserId).toBe("idn_fake_1");

    // Never the plaintext temporary password in the audit trail.
    expect(JSON.stringify(result.audit?.details ?? {})).not.toContain("Fak3Pass");
  });

  it("404s for an unknown teacher", async () => {
    const harness = await makeHarness();
    const result = await harness.handlers["people.teacher-issue-credential"]!(
      ctx({ params: { teacherId: "tch_ghost" } }),
    );
    expect(result.status).toBe(404);
  });

  it("409s when the teacher already has a login", async () => {
    const harness = await makeHarness();
    const teacherId = await makeTeacher(harness);
    await harness.handlers["people.teacher-link-identity"]!(
      ctx({ params: { teacherId }, body: { identityUserId: "user-9" } }),
    );

    const result = await harness.handlers["people.teacher-issue-credential"]!(
      ctx({ params: { teacherId } }),
    );
    expect(result.status).toBe(409);
  });

  it("409s and maps UsernameTakenError when the derived username collides", async () => {
    const failingIdentity: CredentialIssuer = {
      issueCredential: async (input) => {
        throw new UsernameTakenError(input.username);
      },
    };
    const harness = await makeHarness({ identity: failingIdentity });
    const teacherId = await makeTeacher(harness);

    const result = await harness.handlers["people.teacher-issue-credential"]!(
      ctx({ params: { teacherId } }),
    );
    expect(result.status).toBe(409);
    expect((result.body as { message: string }).message).toContain("already taken");

    // No partial state: the teacher was never linked.
    const stored = await harness.peopleRepo.getTeacher(teacherId);
    expect(stored?.identityUserId).toBeNull();
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

  it("returns student template headers for the college edition", async () => {
    const { handlers } = await makeHarness();
    const res = await handlers["people.import-template"]!(ctx({ query: { kind: "students" } }));
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/csv");
    expect(String(res.body).split("\r\n")[0]).toBe(
      "admission_no,full_name,department_code,class_code,section_name",
    );
  });

  it("returns teacher template headers", async () => {
    const { handlers } = await makeHarness();
    const res = await handlers["people.import-template"]!(ctx({ query: { kind: "teachers" } }));
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/csv");
    expect(String(res.body)).toBe("staff_no,full_name");
  });

  it("downloads only the rejected rows as CSV, with formula injection defused", async () => {
    const { handlers, importsRepo, org } = await makeHarness();
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
    const importId = (accepted.body as { importId: string }).importId;
    // A warning row was imported successfully — it must NOT appear here.
    await importsRepo.finish(importId, {
      status: "completed",
      totalRows: 3,
      okRows: 2,
      errorRows: 2,
      warningRows: 1,
      processedRows: 3,
      errors: [
        { row: 2, message: "duplicate staff number" },
        { row: 3, message: "=cmd|'/c calc'!A1" },
      ],
      warnings: [{ row: 4, message: "blank department code, left unassigned" }],
    });

    const res = await handlers["people.import-errors"]!(ctx({ params: { importId } }));
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/csv");
    const lines = String(res.body).split("\r\n");
    expect(lines[0]).toBe("row,reason");
    expect(lines).toHaveLength(3);
    expect(lines).toContain("2,duplicate staff number");
    // Formula-injection leader neutralised: a leading single quote defuses it
    // for the spreadsheet (no comma/quote/CRLF here, so no RFC-4180 wrapping).
    expect(lines).toContain(`3,'=cmd|'/c calc'!A1`);
    expect(String(res.body)).not.toContain("blank department code");
  });

  it("404s an errors download for an unknown import", async () => {
    const { handlers } = await makeHarness();
    expect(
      (await handlers["people.import-errors"]!(ctx({ params: { importId: "imp_ghost" } }))).status,
    ).toBe(404);
  });
});

describe("people.department-create on the school edition", () => {
  it("refuses: a school has no department level", async () => {
    const { handlers } = await makeHarness({ edition: "school" });
    const result = await handlers["people.department-create"]!(
      ctx({ body: { collegeId: "col_1", name: "Science", code: "SCI" } }),
    );
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ message: "the school edition has no department level" });
  });

  it("still allows it on the college edition (the regression net)", async () => {
    const { handlers, org } = await makeHarness({ edition: "college" });
    const result = await handlers["people.department-create"]!(
      ctx({ body: { collegeId: org.college.id, name: "Science", code: "SCI2" } }),
    );
    expect(result.status).toBe(201);
  });
});

describe("people.import-template diverges by edition (#13, ADR-0023)", () => {
  it("offers standard_code + section_name on the school edition, with no department column", async () => {
    const { handlers } = await makeHarness({ edition: "school" });
    const res = await handlers["people.import-template"]!(ctx({ query: { kind: "students" } }));
    expect(res.status).toBe(200);
    const header = String(res.body).split("\r\n")[0];
    expect(header).toBe("admission_no,full_name,standard_code,section_name");
    expect(header).not.toContain("department_code");
  });

  it("offers the same teacher columns on both editions (no org structure in them)", async () => {
    const college = await makeHarness({ edition: "college" });
    const school = await makeHarness({ edition: "school" });
    const headerFor = async (h: Awaited<ReturnType<typeof makeHarness>>) =>
      String((await h.handlers["people.import-template"]!(ctx({ query: { kind: "teachers" } }))).body).split(
        "\r\n",
      )[0];
    expect(await headerFor(school)).toBe(await headerFor(college));
  });
});

describe("year-end progression (N6)", () => {
  async function yearEnd() {
    const harness = await makeHarness({ edition: "school" });
    const { orgRepo, peopleRepo, org } = harness;
    const nextClass = await orgRepo.createClass({ departmentId: org.department.id, name: "Standard 6", code: "STD6" });
    const nextSection = await orgRepo.createSection({ classId: nextClass.id, name: "A" });
    const repeatSection = await orgRepo.createSection({ classId: org.classRow.id, name: "B" });
    const pupils: { student: Awaited<ReturnType<typeof peopleRepo.createStudent>>; enrollment: Awaited<ReturnType<typeof peopleRepo.createEnrollment>> }[] = [];
    for (const [n, name] of ["Asha", "Dev", "Ira", "Kabir"].entries()) {
      const student = await peopleRepo.createStudent({ collegeId: org.college.id, admissionNo: `S-${n}`, fullName: name });
      const enrollment = await peopleRepo.createEnrollment({ studentId: student.id, sectionId: org.section.id, academicYear: "2026-27", startsOn: "2026-06-01" });
      pupils.push({ student, enrollment });
    }
    const choice = (index: number, outcome: string, reason?: string) =>
      ({ studentId: pupils[index]!.student.id, enrollmentId: pupils[index]!.enrollment.id, outcome, ...(reason ? { reason } : {}) });
    const plan = (overrides: Record<string, unknown> = {}) => ({
      sectionId: org.section.id, academicYear: "2026-27", endsOn: "2027-03-31",
      targetAcademicYear: "2027-28", startsOn: "2027-06-01",
      promoteToSectionId: nextSection.id, detainInSectionId: repeatSection.id,
      pupils: [choice(0, "promote"), choice(1, "detain", "Below the attendance minimum"), choice(2, "transfer_out", "Family moved to Pune")],
      expectedHistoryPolicyVersion: 1,
      ...overrides,
    });
    return { ...harness, nextSection, repeatSection, pupils, choice, plan };
  }

  it("checks enrollment scope before reading reversal audit evidence", async () => {
    const { handlers, scopeChecker, pupils } = await yearEnd();
    scopeChecker.decision = { granted: false, reason: "outside scope" };
    const result = await handlers["people.progression-reverse"]!(ctx({
      params: { studentId: pupils[0]!.student.id, enrollmentId: pupils[0]!.enrollment.id },
      body: { reason: "Wrong result" },
    }));
    expect(result.status).toBe(403);
  });

  it("previews every pupil's change, and who is left undecided, without writing", async () => {
    const { handlers, plan, peopleRepo, org, applied } = await yearEnd();
    const result = await handlers["people.progression-preview"]!(ctx({ body: plan() }));
    expect(result.status).toBe(200);
    const preview = result.body as { ready: boolean; pupils: { fullName: string; outcome: string; statusAfter: string; familyLinks: number }[]; undecided: { fullName: string }[]; familyAccess: unknown };
    expect(preview.ready).toBe(true);
    expect(preview.pupils.map((pupil) => [pupil.fullName, pupil.outcome, pupil.statusAfter, pupil.familyLinks])).toEqual([
      ["Asha", "promote", "active", 0],
      ["Dev", "detain", "active", 0],
      ["Ira", "transfer_out", "transferred", 1],
    ]);
    expect(preview.undecided.map((pupil) => pupil.fullName)).toEqual(["Kabir"]);
    // Live family access ends after the leaving day; read-only access runs 90 days more.
    expect(preview.familyAccess).toEqual({ liveUntil: "2027-04-01T00:00:00.000Z", historicalAccessUntil: "2027-06-30T00:00:00.000Z", days: 90, policyVersion: 1 });
    expect(await peopleRepo.roster(org.section.id)).toHaveLength(4);
    expect(applied).toEqual([]);
  });

  it("applies exactly the previewed rows, attributed to the caller and audited in the transaction", async () => {
    const { handlers, plan, applied, nextSection, repeatSection, pupils } = await yearEnd();
    const result = await handlers["people.progression-apply"]!(ctx({ body: plan() }));
    expect(result.status).toBe(200);
    expect(result.audit?.persisted?.kind).toBe("in-transaction");
    expect(applied).toHaveLength(1);
    const [input] = applied;
    expect(input!.attribution).toEqual({ requestId: "req-1", actorType: "user", actorId: "admin-1" });
    expect(input!.familyAccess).toEqual({ liveUntil: new Date("2027-04-01T00:00:00Z"), historicalAccessUntil: new Date("2027-06-30T00:00:00Z") });
    expect(input!.rows).toEqual([
      { studentId: pupils[0]!.student.id, enrollmentId: pupils[0]!.enrollment.id, outcome: "promoted", reason: null, statusAfter: "active", next: { sectionId: nextSection.id, academicYear: "2027-28", startsOn: "2027-06-01" } },
      { studentId: pupils[1]!.student.id, enrollmentId: pupils[1]!.enrollment.id, outcome: "detained", reason: "Below the attendance minimum", statusAfter: "active", next: { sectionId: repeatSection.id, academicYear: "2027-28", startsOn: "2027-06-01" } },
      { studentId: pupils[2]!.student.id, enrollmentId: pupils[2]!.enrollment.id, outcome: "transferred_out", reason: "Family moved to Pune", statusAfter: "transferred", next: null },
    ]);
  });

  it("refuses an exit apply without the policy version shown in its preview", async () => {
    const { handlers, plan, applied } = await yearEnd();
    const result = await handlers["people.progression-apply"]!(ctx({ body: plan({ expectedHistoryPolicyVersion: undefined }) }));
    expect(result.status).toBe(409);
    expect(applied).toEqual([]);
  });

  it("refuses a plan with problems, names them, and writes nothing", async () => {
    const { handlers, plan, choice, applied, org } = await yearEnd();
    const blocked = await handlers["people.progression-apply"]!(ctx({ body: plan({
      endsOn: "2027-04-11",
      promoteToSectionId: org.section.id,
      pupils: [choice(0, "promote"), choice(1, "detain"), { ...choice(2, "graduate"), enrollmentId: "enr_stale" }, choice(3, "transfer_out", "Moved")],
    }) }));
    expect(blocked.status).toBe(422);
    const preview = (blocked.body as { preview: { ready: boolean; problems: string[]; pupils: { problems: string[] }[] } }).preview;
    expect(preview.ready).toBe(false);
    expect(preview.problems).toEqual(["The closing date cannot be later than today.", "Promoted pupils move to a section of a different standard."]);
    expect(preview.pupils.map((pupil) => pupil.problems)).toEqual([
      [],
      ["Record why the pupil is detained."],
      ["Not on this section's 2026-27 roll any more. Reload the roster.", "Record the reason for leaving."],
      [],
    ]);
    expect(applied).toEqual([]);
  });

  it("requires a reason for graduation before applying any exit", async () => {
    const { handlers, plan, choice, applied } = await yearEnd();
    const result = await handlers["people.progression-apply"]!(ctx({ body: plan({
      pupils: [choice(3, "graduate")],
    }) }));
    expect(result.status).toBe(422);
    expect((result.body as { preview: { pupils: { problems: string[] }[] } }).preview.pupils[0]!.problems)
      .toEqual(["Record the reason for leaving."]);
    expect(applied).toEqual([]);
  });

  it("limits the one-pupil exit workflow to today and one leaving pupil", async () => {
    const { handlers, plan, choice, applied } = await yearEnd();
    const one = { workflow: "single_exit", targetAcademicYear: undefined, startsOn: undefined,
      promoteToSectionId: undefined, detainInSectionId: undefined,
      pupils: [choice(0, "graduate", "Completed final standard")] };
    const past = await handlers["people.progression-apply"]!(ctx({ body: plan({ ...one, endsOn: "2027-04-09" }) }));
    expect(past.status).toBe(422);
    expect((past.body as { preview: { problems: string[] } }).preview.problems)
      .toContain("A one-pupil exit must be recorded for today.");
    const mixed = await handlers["people.progression-preview"]!(ctx({ body: plan({ ...one,
      endsOn: "2027-04-10", pupils: [choice(0, "graduate", "Completed"), choice(1, "promote")],
    }) }));
    expect((mixed.body as { ready: boolean; problems: string[] }).problems)
      .toContain("Choose one pupil to transfer or graduate.");
    const today = await handlers["people.progression-preview"]!(ctx({ body: plan({ ...one, endsOn: "2027-04-10" }) }));
    expect((today.body as { ready: boolean }).ready).toBe(true);
    expect(applied).toEqual([]);
  });

  it("needs a next year that follows the closed one, starting after the closing date", async () => {
    const { handlers, plan } = await yearEnd();
    const result = await handlers["people.progression-preview"]!(ctx({ body: plan({ targetAcademicYear: "2026-27", startsOn: "2027-03-31" }) }));
    expect((result.body as { problems: string[] }).problems).toEqual([
      "Choose a next academic year after the one being closed.",
      "The new year must start after the closing date.",
    ]);
  });

  it("flags a pupil already enrolled for the next year", async () => {
    const { handlers, plan, peopleRepo, pupils, nextSection } = await yearEnd();
    await peopleRepo.createEnrollment({ studentId: pupils[0]!.student.id, sectionId: nextSection.id, academicYear: "2027-28", startsOn: "2027-06-01" });
    const result = await handlers["people.progression-preview"]!(ctx({ body: plan() }));
    expect((result.body as { pupils: { problems: string[] }[] }).pupils[0]!.problems).toEqual(["Already enrolled for 2027-28."]);
  });

  it("checks scope on the source section and every target, and refuses outside it", async () => {
    const { handlers, plan, scopeChecker, org, nextSection, repeatSection } = await yearEnd();
    await handlers["people.progression-preview"]!(ctx({ body: plan() }));
    expect(scopeChecker.calls.map((call) => [call.action, (call.resource as { org: { sectionId?: string } }).org.sectionId])).toEqual([
      ["update", org.section.id], ["create", nextSection.id], ["create", repeatSection.id],
    ]);
    scopeChecker.decision = { granted: false, reason: "stub-deny" };
    expect((await handlers["people.progression-apply"]!(ctx({ body: plan() }))).status).toBe(403);
  });

  it("treats a target section in another school as not found", async () => {
    const { handlers, plan, orgRepo } = await yearEnd();
    const elsewhere = await orgRepo.createCollege({ name: "Other", code: "OT" });
    const department = await orgRepo.createDepartment({ collegeId: elsewhere.id, name: "School", code: "SCH" });
    const klass = await orgRepo.createClass({ departmentId: department.id, name: "Standard 6", code: "STD6" });
    const section = await orgRepo.createSection({ classId: klass.id, name: "A" });
    expect((await handlers["people.progression-apply"]!(ctx({ body: plan({ promoteToSectionId: section.id }) }))).status).toBe(404);
  });

  it("refuses a bare exit status in the school edition, so every exit goes through the recorded workflow", async () => {
    const { handlers, pupils } = await yearEnd();
    const flip = (status: string) => handlers["people.student-update"]!(ctx({ params: { studentId: pupils[0]!.student.id }, body: { status } }));
    expect((await flip("transferred")).status).toBe(409);
    expect((await flip("alumni")).status).toBe(409);
    expect((await flip("dropped")).status).toBe(200);
    const college = await makeHarness({ edition: "college" });
    const student = await college.peopleRepo.createStudent({ collegeId: college.org.college.id, admissionNo: "C-1", fullName: "College Pupil" });
    expect((await college.handlers["people.student-update"]!(ctx({ params: { studentId: student.id }, body: { status: "transferred" } }))).status).toBe(200);
  });
});
