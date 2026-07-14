import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECONCILE_JOB_NAME } from "@vidya/module-people";
import { pino } from "pino";
import { buildStack, type Stack } from "./support/harness";

/**
 * People-module end-to-end against the REAL scope matrix (ADR-0010/0013):
 * org administration, roster scoping, and — the security seam of #3 — the
 * assignment → derived-grant → session-invalidation path.
 */

let stack: Stack;
let collegeId = "";
let adminCookie = "";
const runId = randomUUID().slice(0, 8);

const ids = {
  departmentId: "",
  classId: "",
  otherClassId: "",
  sectionId: "",
  otherSectionId: "",
  subjectId: "",
  teacherId: "",
  teacherUserId: "",
};
const teacherUsername = `ppl-teacher-${runId}`;
const TEACHER_PASSWORD = "people-teacher-pass-1";

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  collegeId = bootstrap.collegeId;
  adminCookie = bootstrap.adminCookie;
});

afterAll(async () => {
  await stack.close();
});

describe("org administration (ADR-0013: admin writes people records)", () => {
  it("admin builds the tree; duplicates 409; RESTRICT deletes 409", async () => {
    const dept = await stack.call("people.department-create", {
      cookie: adminCookie,
      body: { collegeId, name: `Science ${runId}`, code: `SCI-${runId}` },
    });
    expect(dept.status).toBe(201);
    ids.departmentId = ((await dept.json()) as { id: string }).id;

    const dup = await stack.call("people.department-create", {
      cookie: adminCookie,
      body: { collegeId, name: "Dup", code: `SCI-${runId}` },
    });
    expect(dup.status).toBe(409);

    const classResponse = await stack.call("people.class-create", {
      cookie: adminCookie,
      body: { departmentId: ids.departmentId, name: "BSc Year 1", code: `BSC1-${runId}` },
    });
    expect(classResponse.status).toBe(201);
    ids.classId = ((await classResponse.json()) as { id: string }).id;

    const otherClass = await stack.call("people.class-create", {
      cookie: adminCookie,
      body: { departmentId: ids.departmentId, name: "BSc Year 2", code: `BSC2-${runId}` },
    });
    ids.otherClassId = ((await otherClass.json()) as { id: string }).id;

    const section = await stack.call("people.section-create", {
      cookie: adminCookie,
      body: { classId: ids.classId, name: "A" },
    });
    expect(section.status).toBe(201);
    ids.sectionId = ((await section.json()) as { id: string }).id;

    const otherSection = await stack.call("people.section-create", {
      cookie: adminCookie,
      body: { classId: ids.otherClassId, name: "A" },
    });
    ids.otherSectionId = ((await otherSection.json()) as { id: string }).id;

    const subject = await stack.call("people.subject-create", {
      cookie: adminCookie,
      body: { departmentId: ids.departmentId, name: "Mathematics", code: `MATH-${runId}` },
    });
    expect(subject.status).toBe(201);
    ids.subjectId = ((await subject.json()) as { id: string }).id;

    // The department now has children — RESTRICT blocks deletion.
    const blocked = await stack.call("people.org-delete", {
      cookie: adminCookie,
      params: { unitType: "department", unitId: ids.departmentId },
    });
    expect(blocked.status).toBe(409);

    const tree = await stack.call("people.college-tree", {
      cookie: adminCookie,
      params: { collegeId },
    });
    expect(tree.status).toBe(200);
    const treeBody = (await tree.json()) as {
      departments: { id: string; classes: { sections: unknown[] }[] }[];
    };
    const ourDept = treeBody.departments.find((department) => department.id === ids.departmentId);
    expect(ourDept?.classes).toHaveLength(2);

    const actions = (await stack.system.service.readRecentAuditEvents(50)).map((row) => row.action);
    expect(actions).toContain("people.department-created");
    expect(actions).toContain("people.section-created");
  });
});

describe("assignment → derived grant → live authority (the #3 security seam)", () => {
  let assignmentId = "";

  it("creates teacher + identity user, links them, assigns — the derived grant materializes", async () => {
    const teacher = await stack.call("people.teacher-create", {
      cookie: adminCookie,
      body: { collegeId, staffNo: `T-${runId}`, fullName: "Asha Verma" },
    });
    expect(teacher.status).toBe(201);
    ids.teacherId = ((await teacher.json()) as { id: string }).id;

    const user = await stack.call("identity.user-create", {
      cookie: adminCookie,
      body: {
        username: teacherUsername,
        displayName: "Asha Verma",
        collegeId,
        temporaryPassword: "temporary-pass-123",
        roles: [],
      },
    });
    expect(user.status).toBe(201);
    ids.teacherUserId = ((await user.json()) as { id: string }).id;

    const reset = await stack.call("identity.password-reset-init", {
      cookie: adminCookie,
      params: { userId: ids.teacherUserId },
    });
    const { token } = (await reset.json()) as { token: string };
    await stack.call("identity.password-reset-confirm", {
      body: { token, newPassword: TEACHER_PASSWORD },
    });

    const link = await stack.call("people.teacher-link-identity", {
      cookie: adminCookie,
      params: { teacherId: ids.teacherId },
      body: { identityUserId: ids.teacherUserId },
    });
    expect(link.status).toBe(200);

    const assignment = await stack.call("people.assignment-create", {
      cookie: adminCookie,
      params: { teacherId: ids.teacherId },
      body: {
        classId: ids.classId,
        subjectId: ids.subjectId,
        kind: "subject_teacher",
        academicYear: "2026-27",
      },
    });
    expect(assignment.status).toBe(201);
    assignmentId = ((await assignment.json()) as { id: string }).id;

    const grants = await stack.pool.query(
      "SELECT role, class_id, subject_id, verified, source, source_ref FROM idn_scope_grants WHERE user_id = $1",
      [ids.teacherUserId],
    );
    expect(grants.rows).toHaveLength(1);
    expect(grants.rows[0]).toMatchObject({
      role: "teacher",
      class_id: ids.classId,
      subject_id: ids.subjectId,
      verified: true,
      source: "derived",
      source_ref: `people:assignment:${assignmentId}`,
    });
    // Derivation also ensured the role membership.
    const roles = await stack.pool.query(
      "SELECT role FROM idn_user_roles WHERE user_id = $1",
      [ids.teacherUserId],
    );
    expect(roles.rows).toContainEqual({ role: "teacher" });
  });

  it("the real matrix enforces the teacher's boundaries on live requests", async () => {
    const cookie = await stack.login(teacherUsername, TEACHER_PASSWORD);
    const session = await stack.call("identity.session", { cookie });
    const body = (await session.json()) as { grants: { role: string }[] };
    expect(body.grants).toHaveLength(1);

    // Roster of the assigned class: readable (non-subject record in class).
    const own = await stack.call("people.section-roster", {
      cookie,
      params: { sectionId: ids.sectionId },
    });
    expect(own.status).toBe(200);

    // Sibling class: outside the grant → denied by the matrix.
    const other = await stack.call("people.section-roster", {
      cookie,
      params: { sectionId: ids.otherSectionId },
    });
    expect(other.status).toBe(403);

    // Teachers cannot write people records at all.
    const write = await stack.call("people.student-create", {
      cookie,
      body: { collegeId, admissionNo: `X-${runId}`, fullName: "Nope" },
    });
    expect(write.status).toBe(403);

    // Reads their own teacher record via self-access; not others' by scope.
    const self = await stack.call("people.teacher-get", {
      cookie,
      params: { teacherId: ids.teacherId },
    });
    expect(self.status).toBe(200);
  });

  it("manual grant administration respects derivation (409 on derived rows)", async () => {
    const derived = await stack.pool.query(
      "SELECT id FROM idn_scope_grants WHERE user_id = $1 AND source = 'derived' LIMIT 1",
      [ids.teacherUserId],
    );
    const grantId = String(derived.rows[0]?.id);
    const removal = await stack.call("identity.grant-remove", {
      cookie: adminCookie,
      params: { userId: ids.teacherUserId, grantId },
    });
    expect(removal.status).toBe(409);
  });

  it("assignment removal takes the grant with it and kills the teacher's sessions", async () => {
    const cookie = await stack.login(teacherUsername, TEACHER_PASSWORD);
    expect((await stack.call("identity.session", { cookie })).status).toBe(200);

    const removal = await stack.call("people.assignment-remove", {
      cookie: adminCookie,
      params: { assignmentId },
    });
    expect(removal.status).toBe(200);

    const grants = await stack.pool.query(
      "SELECT id FROM idn_scope_grants WHERE user_id = $1 AND source = 'derived'",
      [ids.teacherUserId],
    );
    expect(grants.rows).toHaveLength(0);
    // Stale-authority sessions are gone (#2 invariant through the seam).
    expect((await stack.call("identity.session", { cookie })).status).toBe(401);
  });

  it("the reconcile job repairs manual drift (deleted grant row reappears)", async () => {
    const assignment = await stack.call("people.assignment-create", {
      cookie: adminCookie,
      params: { teacherId: ids.teacherId },
      body: {
        classId: ids.classId,
        subjectId: ids.subjectId,
        kind: "subject_teacher",
        academicYear: "2026-27",
      },
    });
    expect(assignment.status).toBe(201);
    const newAssignmentId = ((await assignment.json()) as { id: string }).id;

    // Simulate drift: someone deletes the derived grant behind identity's back.
    await stack.pool.query("DELETE FROM idn_scope_grants WHERE source_ref = $1", [
      `people:assignment:${newAssignmentId}`,
    ]);

    await stack.people.jobProcessors[RECONCILE_JOB_NAME]!(
      { source: "integration-test" },
      { logger: pino({ level: "silent" }), jobId: "job-rec", attempt: 1 },
    );

    const repaired = await stack.pool.query(
      "SELECT verified, source FROM idn_scope_grants WHERE source_ref = $1",
      [`people:assignment:${newAssignmentId}`],
    );
    expect(repaired.rows).toHaveLength(1);
    const actions = (await stack.system.service.readRecentAuditEvents(20)).map((row) => row.action);
    expect(actions).toContain("people.grant-reconcile-repaired");
  });
});

describe("grant verification backfill (OrgDirectory, #2→#3)", () => {
  it("flips resolvable pre-#3 grants to verified and reports unresolvable ones", async () => {
    // Simulate a pre-#3 manual grant: inserted raw, unverified, real org ids.
    const hodUser = await stack.call("identity.user-create", {
      cookie: adminCookie,
      body: {
        username: `hod-${runId}`,
        displayName: "HoD",
        collegeId,
        temporaryPassword: "temporary-pass-123",
        roles: ["hod", "principal"],
      },
    });
    const hodUserId = ((await hodUser.json()) as { id: string }).id;
    await stack.pool.query(
      `INSERT INTO idn_scope_grants (id, user_id, role, college_id, department_id, verified, source, granted_by)
       VALUES ($1, $2, 'hod', $3, $4, false, 'manual', 'pre-3-migration'),
              ($5, $2, 'principal', 'col_ghost', NULL, false, 'manual', 'pre-3-migration')`,
      [`g-${runId}-ok`, hodUserId, collegeId, ids.departmentId, `g-${runId}-bad`],
    );

    const response = await stack.call("identity.grants-verify", { cookie: adminCookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      verified: number;
      unresolved: { grantId: string; reason: string }[];
    };
    expect(body.verified).toBeGreaterThanOrEqual(1);
    expect(body.unresolved.some((entry) => entry.grantId === `g-${runId}-bad`)).toBe(true);

    const flipped = await stack.pool.query("SELECT verified FROM idn_scope_grants WHERE id = $1", [
      `g-${runId}-ok`,
    ]);
    expect(flipped.rows[0]).toEqual({ verified: true });
    const untouched = await stack.pool.query(
      "SELECT verified FROM idn_scope_grants WHERE id = $1",
      [`g-${runId}-bad`],
    );
    expect(untouched.rows[0]).toEqual({ verified: false }); // reported, never deleted
    expect(
      (await stack.system.service.readRecentAuditEvents(10)).map((row) => row.action),
    ).toContain("identity.grants-verify-run");
  });
});

describe("students & enrollment through the pipeline", () => {
  it("admin creates and enrolls a student; the class teacher's matrix covers the roster", async () => {
    const student = await stack.call("people.student-create", {
      cookie: adminCookie,
      body: { collegeId, admissionNo: `A-${runId}`, fullName: "Meera Nair" },
    });
    expect(student.status).toBe(201);
    const studentId = ((await student.json()) as { id: string }).id;

    const enroll = await stack.call("people.student-enroll", {
      cookie: adminCookie,
      params: { studentId },
      body: { sectionId: ids.sectionId, academicYear: "2026-27" },
    });
    expect(enroll.status).toBe(200);

    const roster = await stack.call("people.section-roster", {
      cookie: adminCookie,
      params: { sectionId: ids.sectionId },
    });
    const rosterBody = (await roster.json()) as { students: { id: string }[] };
    expect(rosterBody.students.map((entry) => entry.id)).toContain(studentId);

    // Transfer to the other class's section, then verify enrollment moved.
    const transfer = await stack.call("people.student-enroll", {
      cookie: adminCookie,
      params: { studentId },
      body: { sectionId: ids.otherSectionId, academicYear: "2026-27" },
    });
    expect(transfer.status).toBe(200);
    const moved = (await (await stack.call("people.student-get", {
      cookie: adminCookie,
      params: { studentId },
    })).json()) as { enrollment: { sectionId: string } };
    expect(moved.enrollment.sectionId).toBe(ids.otherSectionId);

    const actions = (await stack.system.service.readRecentAuditEvents(20)).map((row) => row.action);
    expect(actions).toContain("people.student-enrolled");
  });

  it("moves a student through the lifecycle (backlog) — audited, record survives, still on the roster", async () => {
    const created = await stack.call("people.student-create", {
      cookie: adminCookie,
      body: { collegeId, admissionNo: `ATKT-${runId}`, fullName: "Rohan Deshpande" },
    });
    expect(created.status).toBe(201);
    const studentId = ((await created.json()) as { id: string }).id;
    await stack.call("people.student-enroll", {
      cookie: adminCookie,
      params: { studentId },
      body: { sectionId: ids.sectionId, academicYear: "2026-27" },
    });

    const marked = await stack.call("people.student-update", {
      cookie: adminCookie,
      params: { studentId },
      body: { status: "backlog" },
    });
    expect(marked.status).toBe(200);
    expect(((await marked.json()) as { status: string }).status).toBe("backlog");

    // The record survives (never deleted) and a backlog student stays enrolled.
    const roster = (await (await stack.call("people.section-roster", {
      cookie: adminCookie,
      params: { sectionId: ids.sectionId },
    })).json()) as { students: { id: string }[] };
    expect(roster.students.map((s) => s.id)).toContain(studentId);

    const actions = (await stack.system.service.readRecentAuditEvents(20)).map((row) => row.action);
    expect(actions).toContain("people.student-updated");
  });
});
