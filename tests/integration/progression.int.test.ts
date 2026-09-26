import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

/**
 * N6 year-end progression over real Postgres, real sessions, the real route
 * gate and the real scope checker. What unit tests cannot show: that the
 * whole batch is one transaction (an audit failure undoes every pupil), that
 * concluded enrollment rows survive with their outcome, that exits set the
 * ADR-0027 Decision 9 window on the guardian rows, and that a guardian then
 * reads only what the window allows.
 */

let stack: Stack;
let admin: string;
let collegeId: string;
let departmentId: string;
let standard5: string;
let section5A: string;
let section5B: string;
let section6A: string;
let classTeacher: string;

const suffix = randomUUID().slice(0, 8);
const YEAR = "2026-27";
const NEXT = "2027-28";
const DAY = 86_400_000;
const today = new Date().toISOString().slice(0, 10);
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
// Closed yesterday, so live family access ended at the start of today and the
// read-only window is already running.
const endsOn = shift(today, -1);
const joinedOn = shift(today, -60);

async function create(route: string, body: unknown, params?: Record<string, string>) {
  const response = await stack.call(route, { cookie: admin, body, params });
  expect(response.status, `${route}: ${await response.clone().text()}`).toBe(201);
  return (await response.json()) as { id: string };
}

async function pupil(sectionId: string, name: string) {
  const student = await create("people.student-create", { collegeId, admissionNo: `N6-${randomUUID().slice(0, 8)}`, fullName: name });
  const enrolled = await stack.call("people.student-enroll", { cookie: admin, params: { studentId: student.id }, body: { sectionId, academicYear: YEAR, startsOn: joinedOn } });
  expect(enrolled.status, await enrolled.clone().text()).toBe(200);
  const { enrollmentId } = (await enrolled.json()) as { enrollmentId: string };
  return { studentId: student.id, enrollmentId };
}

async function invite(studentId: string) {
  return stack.call("people.guardian-invitation-issue", {
    cookie: admin,
    params: { studentId },
    body: { guardianName: "Meera Iyer", relationshipType: "parent", contactMethod: "email", contactValue: `meera-${randomUUID()}@example.test` },
  });
}

beforeAll(async () => {
  stack = buildStack("school");
  const bootstrap = await stack.bootstrap();
  admin = bootstrap.adminCookie;
  collegeId = bootstrap.collegeId;
  departmentId = (await stack.people.service.ensureImplicitDepartment(collegeId)).departmentId;
  standard5 = (await create("people.class-create", { departmentId, name: `Std 5 ${suffix}`, code: `N6-5-${suffix}` })).id;
  const standard6 = (await create("people.class-create", { departmentId, name: `Std 6 ${suffix}`, code: `N6-6-${suffix}` })).id;
  section5A = (await create("people.section-create", { classId: standard5, name: "A" })).id;
  section5B = (await create("people.section-create", { classId: standard5, name: "B" })).id;
  section6A = (await create("people.section-create", { classId: standard6, name: "A" })).id;

  const username = `n6-ct-${suffix}`;
  const user = await create("identity.user-create", { username, displayName: username, collegeId, temporaryPassword: "temporary-pass-123", roles: [] });
  const reset = await stack.call("identity.password-reset-init", { cookie: admin, params: { userId: user.id } });
  const { token } = (await reset.json()) as { token: string };
  expect((await stack.call("identity.password-reset-confirm", { body: { token, newPassword: "staff-pass-12345" } })).status).toBe(200);
  const teacher = await create("people.teacher-create", { collegeId, staffNo: username, fullName: username });
  await stack.call("people.teacher-link-identity", { cookie: admin, params: { teacherId: teacher.id }, body: { identityUserId: user.id } });
  await create("people.assignment-create", { classId: standard5, academicYear: YEAR, kind: "class_teacher" }, { teacherId: teacher.id });
  classTeacher = await stack.login(username, "staff-pass-12345");
});

afterAll(async () => {
  stack.peopleAuditFault.failAction = null;
  await stack?.close();
});

describe("Year-end progression over real Postgres (N6)", () => {
  it("promotes, detains and transfers out in one audited batch, keeping every concluded row", async () => {
    const asha = await pupil(section5A, "Asha Menon");
    const dev = await pupil(section5A, "Dev Menon");
    const ira = await pupil(section5A, "Ira Menon");
    const kabir = await pupil(section5A, "Kabir Menon");

    // Ira's parent is linked; a second, unused code is still pending at exit.
    const issued = await invite(ira.studentId);
    const { code } = (await issued.json()) as { code: string };
    const parentName = `n6-parent-${suffix}`;
    expect((await stack.call("people.guardian-activate", { body: { code, fullName: "Meera Iyer", username: parentName, password: "n6-parent-pass-123" } })).status).toBe(201);
    const parent = await stack.login(parentName, "n6-parent-pass-123");
    expect((await invite(ira.studentId)).status).toBe(201);

    const plan = {
      sectionId: section5A, academicYear: YEAR, endsOn, targetAcademicYear: NEXT, startsOn: shift(today, 1),
      promoteToSectionId: section6A, detainInSectionId: section5B,
      pupils: [
        { ...asha, outcome: "promote" },
        { ...dev, outcome: "detain", reason: "Did not meet the promotion criteria" },
        { ...ira, outcome: "transfer_out", reason: "Family relocated to Chennai" },
      ],
    };

    // The class teacher cannot run the batch; the administrator previews it.
    expect((await stack.call("people.progression-preview", { cookie: classTeacher, body: plan })).status).toBe(403);
    const previewed = await stack.call("people.progression-preview", { cookie: admin, body: plan });
    expect(previewed.status, await previewed.clone().text()).toBe(200);
    const preview = (await previewed.json()) as { ready: boolean; undecided: { studentId: string }[]; pupils: { familyLinks: number }[] };
    expect(preview.ready).toBe(true);
    expect(preview.undecided.map((row) => row.studentId)).toEqual([kabir.studentId]);
    expect(preview.pupils.map((row) => row.familyLinks)).toEqual([0, 0, 1]);

    const response = await stack.call("people.progression-apply", { cookie: admin, body: plan });
    expect(response.status, await response.clone().text()).toBe(200);
    const { runId } = (await response.json()) as { runId: string };

    const rows = await stack.pool.query(
      "SELECT student_id, section_id, academic_year, status, starts_on::text, ends_on::text, outcome, outcome_reason FROM ppl_enrollments WHERE student_id = ANY($1) ORDER BY student_id, academic_year",
      [[asha.studentId, dev.studentId, ira.studentId, kabir.studentId]],
    );
    const byPupil = (studentId: string) => rows.rows.filter((row) => row.student_id === studentId);
    expect(byPupil(asha.studentId)).toEqual([
      expect.objectContaining({ section_id: section5A, academic_year: YEAR, status: "completed", ends_on: endsOn, outcome: "promoted", outcome_reason: null }),
      expect.objectContaining({ section_id: section6A, academic_year: NEXT, status: "enrolled", starts_on: shift(today, 1), outcome: null }),
    ]);
    expect(byPupil(dev.studentId)).toEqual([
      expect.objectContaining({ section_id: section5A, status: "completed", outcome: "detained", outcome_reason: "Did not meet the promotion criteria" }),
      expect.objectContaining({ section_id: section5B, academic_year: NEXT, status: "enrolled" }),
    ]);
    expect(byPupil(ira.studentId)).toEqual([
      expect.objectContaining({ section_id: section5A, status: "withdrawn", ends_on: endsOn, outcome: "transferred_out", outcome_reason: "Family relocated to Chennai" }),
    ]);
    expect(byPupil(kabir.studentId)).toEqual([expect.objectContaining({ status: "enrolled", outcome: null })]);

    const statuses = await stack.pool.query("SELECT id, status FROM ppl_students WHERE id = ANY($1)", [[asha.studentId, dev.studentId, ira.studentId, kabir.studentId]]);
    expect(Object.fromEntries(statuses.rows.map((row) => [row.id, row.status]))).toEqual({
      [asha.studentId]: "active", [dev.studentId]: "active", [ira.studentId]: "transferred", [kabir.studentId]: "active",
    });

    // ADR-0027 Decision 9 on the guardian rows; the unused code is spent.
    const windows = await stack.pool.query("SELECT valid_until, historical_access_until FROM ppl_student_guardians WHERE student_id = $1", [ira.studentId]);
    expect(windows.rows).toEqual([{ valid_until: new Date(`${today}T00:00:00Z`), historical_access_until: new Date(Date.parse(`${today}T00:00:00Z`) + 90 * DAY) }]);
    const invitations = await stack.pool.query("SELECT status FROM ppl_guardian_invitations WHERE student_id = $1 ORDER BY created_at", [ira.studentId]);
    expect(invitations.rows.map((row) => row.status)).toEqual(["activated", "revoked"]);

    // One event per pupil and one for the batch, all from the same request; defineRoute added none.
    const audit = await stack.pool.query(
      "SELECT action, resource_id, request_id, details FROM sys_audit_log WHERE resource_id = $1 OR details->>'runId' = $1 ORDER BY id",
      [runId],
    );
    expect(audit.rows.map((row) => `${row.action} ${row.resource_id}`).sort()).toEqual([
      `people.progression-applied ${runId}`,
      `people.student-progressed ${asha.studentId}`,
      `people.student-progressed ${dev.studentId}`,
      `people.student-progressed ${ira.studentId}`,
    ].sort());
    expect(new Set(audit.rows.map((row) => row.request_id)).size).toBe(1);
    // The batch event is written last, inside the same transaction.
    expect(audit.rows.at(-1)).toMatchObject({ action: "people.progression-applied", details: { counts: { promoted: 1, detained: 1, transferred_out: 1, graduated: 0 } } });

    // The same plan again: those pupils are no longer on the 2026-27 roll.
    const again = await stack.call("people.progression-apply", { cookie: admin, body: plan });
    expect(again.status).toBe(422);

    // The history keeps the outcome and the status change.
    const history = await stack.call("people.student-history", { cookie: admin, params: { studentId: ira.studentId } });
    const record = (await history.json()) as { enrollments: { outcome: string | null; outcomeReason: string | null }[]; statusChanges: { from: string; to: string }[] };
    expect(record.enrollments).toEqual([expect.objectContaining({ outcome: "transferred_out", outcomeReason: "Family relocated to Chennai" })]);
    expect(record.statusChanges).toEqual([expect.objectContaining({ from: "active", to: "transferred" })]);

    // A closed year still places the promoted pupil for that year's records.
    expect(await stack.people.service.directory.studentPositionForAcademicYear(asha.studentId, YEAR)).toMatchObject({ classId: standard5, sectionId: section5A });

    // The family: read-only attendance and report cards as at the exit; nothing live; no new codes.
    const children = (await (await stack.call("people.guardian-children", { cookie: parent })).json()) as { children: unknown[] };
    expect(children.children).toEqual([expect.objectContaining({
      studentId: ira.studentId, status: "active", categories: ["attendance", "report-card"],
      recordsThrough: `${today}T00:00:00.000Z`, readOnlyUntil: new Date(Date.parse(`${today}T00:00:00Z`) + 90 * DAY).toISOString(),
    })]);
    expect((await stack.call("portal.child-attendance", { cookie: parent, params: { studentId: ira.studentId }, query: { academicYear: YEAR } })).status).toBe(200);
    expect((await stack.call("reporting.child-report-cards", { cookie: parent, params: { studentId: ira.studentId } })).status).toBe(200);
    expect((await stack.call("fees.child-fees", { cookie: parent, params: { studentId: ira.studentId } })).status).toBe(403);
    expect((await stack.call("portal.child-timetable", { cookie: parent, params: { studentId: ira.studentId }, query: { academicYear: YEAR } })).status).toBe(403);
    expect((await invite(ira.studentId)).status).toBe(409);
  });

  it("rolls every pupil back when the batch audit cannot be written (ADR-0026)", async () => {
    const zara = await pupil(section5B, "Zara Pillai");
    const omar = await pupil(section5B, "Omar Pillai");
    const plan = {
      sectionId: section5B, academicYear: YEAR, endsOn, targetAcademicYear: NEXT, startsOn: shift(today, 1),
      promoteToSectionId: section6A,
      pupils: [{ ...zara, outcome: "promote" }, { ...omar, outcome: "graduate" }],
    };
    const before = await stack.pool.query("SELECT count(*)::int AS n FROM sys_audit_log WHERE action = 'people.student-progressed'");

    stack.peopleAuditFault.failAction = "people.progression-applied";
    expect((await stack.call("people.progression-apply", { cookie: admin, body: plan })).status).toBe(500);
    stack.peopleAuditFault.failAction = null;

    const untouched = await stack.pool.query("SELECT status, outcome, ends_on FROM ppl_enrollments WHERE student_id = ANY($1)", [[zara.studentId, omar.studentId]]);
    expect(untouched.rows).toEqual([
      { status: "enrolled", outcome: null, ends_on: null },
      { status: "enrolled", outcome: null, ends_on: null },
    ]);
    const statuses = await stack.pool.query("SELECT status FROM ppl_students WHERE id = ANY($1)", [[zara.studentId, omar.studentId]]);
    expect(statuses.rows.map((row) => row.status)).toEqual(["active", "active"]);
    const after = await stack.pool.query("SELECT count(*)::int AS n FROM sys_audit_log WHERE action = 'people.student-progressed'");
    expect(after.rows[0].n).toBe(before.rows[0].n);

    // Nothing was left half-done, so the same plan now applies cleanly.
    expect((await stack.call("people.progression-apply", { cookie: admin, body: plan })).status).toBe(200);
    const graduated = await stack.pool.query("SELECT status FROM ppl_students WHERE id = $1", [omar.studentId]);
    expect(graduated.rows[0].status).toBe("alumni");
  });
});
