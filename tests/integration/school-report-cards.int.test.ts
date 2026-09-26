import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

/**
 * School report cards against real Postgres, real authentication and the real
 * scope checker.
 *
 * What only a real database can prove, and is therefore proved here rather
 * than with mocks: that a snapshot is IMMUTABLE (the table refuses UPDATE and
 * DELETE), that regenerating appends rather than overwrites, that the stored
 * payload is what the PDF renders from, and that authorization is resolved
 * server-side so a caller cannot reach another class's pupil by id.
 */

let stack: Stack;
let admin: string;
let outsider: string;
let teacher: string;
let collegeId: string;
let classId: string;
let otherClassId: string;
let sectionId: string;
let subjectId: string;
let termId: string;
let typeId: string;
let scaleId: string;
let studentId: string;
let otherStudentId: string;
let assessmentId: string;

const suffix = randomUUID().slice(0, 8);
const academicYear = "2026-27";
const bands = [
  { minPct: 80, grade: "A", points: 10 },
  { minPct: 40, grade: "B", points: 5 },
  { minPct: 0, grade: "F", points: 0 },
];

async function create(route: string, body: unknown, params?: Record<string, string>) {
  const response = await stack.call(route, { cookie: admin, body, params });
  expect(response.status, `${route}: ${await response.clone().text()}`).toBe(201);
  return (await response.json()) as { id: string };
}

/** A signed-in user. `assignments` decides what they may reach: an empty list
 *  leaves them authenticated but with no grant over this college's classes. */
async function provisionUser(
  prefix: string,
  assignments: { kind: "subject_teacher" | "class_teacher"; subjectId?: string }[],
  roles: ("admin" | "principal")[] = [],
): Promise<string> {
  const username = `${prefix}-${randomUUID().slice(0, 8)}`;
  const user = await create("identity.user-create", {
    username,
    displayName: username,
    collegeId,
    temporaryPassword: "temporary-pass-123",
    roles,
  });
  const reset = await stack.call("identity.password-reset-init", {
    cookie: admin,
    params: { userId: user.id },
  });
  const { token } = (await reset.json()) as { token: string };
  expect(
    (
      await stack.call("identity.password-reset-confirm", {
        body: { token, newPassword: "report-card-pass-123" },
      })
    ).status,
  ).toBe(200);

  if (assignments.length > 0) {
    const person = await create("people.teacher-create", { collegeId, staffNo: username, fullName: username });
    expect(
      (
        await stack.call("people.teacher-link-identity", {
          cookie: admin,
          params: { teacherId: person.id },
          body: { identityUserId: user.id },
        })
      ).status,
    ).toBe(200);
    for (const assignment of assignments) {
      await create("people.assignment-create", { classId, academicYear, ...assignment }, { teacherId: person.id });
    }
  }
  return stack.login(username, "report-card-pass-123");
}

beforeAll(async () => {
  stack = buildStack("school");
  const bootstrap = await stack.bootstrap();
  admin = bootstrap.adminCookie;
  collegeId = bootstrap.collegeId;
  const { departmentId } = await stack.people.service.ensureImplicitDepartment(collegeId);

  classId = (await create("people.class-create", { departmentId, name: `Std ${suffix}`, code: `RC-${suffix}` })).id;
  otherClassId = (await create("people.class-create", { departmentId, name: `Std other ${suffix}`, code: `RCO-${suffix}` })).id;
  sectionId = (await create("people.section-create", { classId, name: "A" })).id;
  const otherSectionId = (await create("people.section-create", { classId: otherClassId, name: "A" })).id;
  subjectId = (await create("people.subject-create", { departmentId, name: `Math ${suffix}`, code: `RC-M-${suffix}` })).id;

  studentId = (await create("people.student-create", { collegeId, admissionNo: `RC-${suffix}`, fullName: "Asha Kulkarni" })).id;
  otherStudentId = (await create("people.student-create", { collegeId, admissionNo: `RCO-${suffix}`, fullName: "Ravi Deshmukh" })).id;
  expect(
    (await stack.call("people.student-enroll", { cookie: admin, body: { sectionId, academicYear, startsOn: "2026-06-01" }, params: { studentId } })).status,
  ).toBe(200);
  expect(
    (await stack.call("people.student-enroll", { cookie: admin, body: { sectionId: otherSectionId, academicYear, startsOn: "2026-06-01" }, params: { studentId: otherStudentId } })).status,
  ).toBe(200);

  termId = (await create("school-academics.create", {
    collegeId,
    name: `Term ${suffix}`,
    academicYear,
    startsOn: "2026-06-01",
    endsOn: "2026-06-05",
  })).id;
  const configured = await stack.call("school-academics.types-set", {
    cookie: admin,
    params: { termId },
    body: { types: [{ name: "Exam", weight: 100 }] },
  });
  expect(configured.status).toBe(200);
  typeId = ((await configured.json()) as { types: { id: string }[] }).types[0]!.id;
  scaleId = (await create("results.scale-create", { collegeId, name: `Scale ${suffix}`, bands })).id;

  // The class's own teacher: subject_teacher to own the assessment and its
  // marks, class_teacher to take a whole-section register.
  teacher = await provisionUser("rc-tch", [
    { kind: "subject_teacher", subjectId },
    { kind: "class_teacher" },
  ]);
  const assessment = await stack.call("school-academics.assessment-create", {
    cookie: teacher,
    body: { classId, subjectId, termId, typeId, scaleId, name: "Unit test", maxScore: 20, heldOn: "2026-06-02" },
  });
  expect(assessment.status, await assessment.clone().text()).toBe(201);
  assessmentId = ((await assessment.json()) as { id: string }).id;

  outsider = await provisionUser("rc-out", []);
});

afterAll(async () => {
  await stack?.close();
});

const preview = (cookie: string, student = studentId) =>
  stack.call("reporting.school-report-card-preview", { cookie, body: { studentId: student, termId } });
const generate = (cookie: string, student = studentId) =>
  stack.call("reporting.school-report-card-generate", { cookie, body: { studentId: student, termId } });
const roster = (cookie: string, cls = classId) =>
  stack.call("reporting.school-report-card-roster", { cookie, params: { classId: cls }, query: { termId } });

describe("School report cards over real Postgres", () => {
  it("requires authentication on every route", async () => {
    const statuses = (
      await Promise.all([
        stack.call("reporting.school-report-card-desk-scope"),
        roster(""),
        preview(""),
        generate(""),
        stack.call("reporting.school-report-card-download", { params: { snapshotId: "src_missing" } }),
      ])
    ).map((response) => response.status);
    expect(statuses).toEqual([401, 401, 401, 401, 401]);
  });

  it("builds the desk from current class scope without disclosing another class", async () => {
    const response = await stack.call("reporting.school-report-card-desk-scope", { cookie: teacher });
    expect(response.status).toBe(200);
    const scope = (await response.json()) as { classes: { id: string; name: string }[]; terms: { id: string }[] };
    expect(scope.classes).toEqual([{ id: classId, collegeId, name: `Std ${suffix}`, canPublish: false }]);
    expect(scope.terms.map((term) => term.id)).toContain(termId);

    const outside = await stack.call("reporting.school-report-card-desk-scope", { cookie: outsider });
    expect(outside.status).toBe(200);
    expect(await outside.json()).toEqual({ classes: [], terms: [] });

    const adminScope = (await (await stack.call("reporting.school-report-card-desk-scope", { cookie: admin })).json()) as { classes: { id: string }[] };
    expect(adminScope.classes.map((item) => item.id)).toEqual(expect.arrayContaining([classId, otherClassId]));
  });

  it("refuses a caller with no grant over the class", async () => {
    expect((await roster(outsider)).status).toBe(403);
    expect((await preview(outsider)).status).toBe(403);
    expect((await generate(outsider)).status).toBe(403);
  });

  it("previews a pupil with no marks as incomplete, never as zero", async () => {
    const response = await preview(admin);
    expect(response.status).toBe(200);
    const card = (await response.json()) as {
      subjects: { subjectId: string; percentage: number | null; complete: boolean }[];
      overall: { percentage: number | null; complete: boolean };
      warnings: string[];
    };

    expect(card.subjects).toHaveLength(1);
    expect(card.subjects[0]!.complete).toBe(false);
    expect(card.subjects[0]!.percentage).toBeNull();
    expect(card.overall.percentage).toBeNull();
    expect(card.warnings.length).toBeGreaterThan(0);
  });

  it("computes from stored marks and attendance once they exist", async () => {
    expect(
      (
        await stack.call("school-academics.marks-enter", {
          cookie: teacher,
          params: { assessmentId },
          body: { entries: [{ studentId, score: 18 }] },
        })
      ).status,
    ).toBe(200);

    // Two registers inside the term window: present, then absent.
    for (const [heldOn, status] of [["2026-06-02", "present"], ["2026-06-03", "absent"]] as const) {
      const recorded = await stack.call("academics.attendance-record", {
        cookie: teacher,
        body: { sectionId, heldOn, slot: "day", academicYear, entries: [{ studentId, status }] },
      });
      expect(recorded.status, await recorded.clone().text()).toBe(201);
    }

    const card = (await (await preview(admin)).json()) as {
      subjects: { percentage: number | null; grade: string | null; complete: boolean }[];
      overall: { percentage: number | null; grade: string | null; complete: boolean };
      attendance: { eligibleDays: number; percentage: number | null; complete: boolean };
    };

    // 18/20 = 90%, one type at 100% weight, band A.
    expect(card.subjects[0]!.complete).toBe(true);
    expect(card.subjects[0]!.percentage).toBe(90);
    expect(card.subjects[0]!.grade).toBe("A");
    expect(card.overall.percentage).toBe(90);
    // One present of two registered days.
    expect(card.attendance.complete).toBe(true);
    expect(card.attendance.eligibleDays).toBe(2);
    expect(card.attendance.percentage).toBe(50);
  });

  it("issues a snapshot, audits it, and shows it on the roster", async () => {
    const response = await generate(admin);
    expect(response.status, await response.clone().text()).toBe(201);
    const issued = (await response.json()) as { snapshotId: string; generatedAt: string };
    expect(issued.snapshotId).toMatch(/^src_/);

    const listed = (await (await roster(admin)).json()) as {
      students: { studentId: string; snapshotId: string | null; admissionNo: string }[];
    };
    const row = listed.students.find((student) => student.studentId === studentId);
    expect(row?.snapshotId).toBe(issued.snapshotId);
    expect(row?.admissionNo).toBe(`RC-${suffix}`);

    const audit = await stack.pool.query(
      "SELECT action FROM sys_audit_log WHERE action = $1 AND resource_id = $2",
      ["reporting.school-report-card-generated", studentId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("REFUSES to update or delete an issued snapshot, in the database itself", async () => {
    const issued = (await (await generate(admin)).json()) as { snapshotId: string };

    // The application never issues these statements; the point is that the
    // database would reject them even if something did.
    await expect(
      stack.pool.query("UPDATE rpt_school_report_cards SET payload = '{}'::jsonb WHERE id = $1", [
        issued.snapshotId,
      ]),
    ).rejects.toThrow(/append-only/);

    await expect(
      stack.pool.query("DELETE FROM rpt_school_report_cards WHERE id = $1", [issued.snapshotId]),
    ).rejects.toThrow(/append-only/);

    const still = await stack.pool.query("SELECT id FROM rpt_school_report_cards WHERE id = $1", [
      issued.snapshotId,
    ]);
    expect(still.rows).toHaveLength(1);
  });

  it("appends a new snapshot when marks change, leaving the old one exactly as issued", async () => {
    const first = (await (await generate(admin)).json()) as { snapshotId: string };
    const beforePdf = await stack.call("reporting.school-report-card-download", {
      cookie: admin,
      params: { snapshotId: first.snapshotId },
    });
    expect(beforePdf.status).toBe(200);
    const beforeBytes = Buffer.from(await beforePdf.arrayBuffer());

    // Correct the mark downward, then issue again.
    expect(
      (
        await stack.call("school-academics.marks-enter", {
          cookie: teacher,
          params: { assessmentId },
          body: { entries: [{ studentId, score: 10 }] },
        })
      ).status,
    ).toBe(200);

    const second = (await (await generate(admin)).json()) as { snapshotId: string };
    expect(second.snapshotId).not.toBe(first.snapshotId);

    // The NEW snapshot reflects the correction: 10/20 = 50%.
    const latest = (await (await preview(admin)).json()) as { subjects: { percentage: number | null }[] };
    expect(latest.subjects[0]!.percentage).toBe(50);

    // The OLD snapshot's document is unchanged — this is the whole point.
    const afterPdf = await stack.call("reporting.school-report-card-download", {
      cookie: admin,
      params: { snapshotId: first.snapshotId },
    });
    const afterBytes = Buffer.from(await afterPdf.arrayBuffer());
    expect(afterBytes.equals(beforeBytes)).toBe(true);

    const stored = await stack.pool.query<{ pct: string }>(
      "SELECT payload->'subjects'->0->>'percentage' AS pct FROM rpt_school_report_cards WHERE id = $1",
      [first.snapshotId],
    );
    expect(stored.rows[0]!.pct).toBe("90");
  });

  it("downloads a real PDF, and refuses a caller outside the snapshot's scope", async () => {
    const issued = (await (await generate(admin)).json()) as { snapshotId: string };

    const ok = await stack.call("reporting.school-report-card-download", {
      cookie: admin,
      params: { snapshotId: issued.snapshotId },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("application/pdf");
    const bytes = Buffer.from(await ok.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // A guessed snapshot id is not authority: authorization uses the org path
    // recorded on the row, re-checked against the caller's current scope.
    const denied = await stack.call("reporting.school-report-card-download", {
      cookie: outsider,
      params: { snapshotId: issued.snapshotId },
    });
    expect(denied.status).toBe(403);

    const missing = await stack.call("reporting.school-report-card-download", {
      cookie: admin,
      params: { snapshotId: "src_does-not-exist" },
    });
    expect(missing.status).toBe(404);
  });

  it("rejects a term that belongs to a different school, and an unknown term", async () => {
    const otherCollege = await stack.people.service.bootstrapCollege({
      name: `Other school ${suffix}`,
      code: `OS-${suffix}`,
    });
    const { departmentId: otherDepartmentId } = await stack.people.service.ensureImplicitDepartment(
      otherCollege.collegeId,
    );

    // Seeded with a direct INSERT rather than through the API on purpose: the
    // admin's grants cover only their own college, so school-academics.create
    // correctly answers 403 for a foreign one. That refusal is the isolation
    // working; this fixture exists to prove the REPORT-CARD route refuses the
    // cross-school term too, instead of silently reporting on it.
    const foreignTermId = `sct_foreign_${suffix}`;
    await stack.pool.query(
      `INSERT INTO sca_terms (id, college_id, department_id, name, academic_year, starts_on, ends_on, status)
       VALUES ($1, $2, $3, $4, $5, '2026-06-01', '2026-06-05', 'open')`,
      [foreignTermId, otherCollege.collegeId, otherDepartmentId, `Foreign term ${suffix}`, academicYear],
    );

    const mismatched = await stack.call("reporting.school-report-card-preview", {
      cookie: admin,
      body: { studentId, termId: foreignTermId },
    });
    expect(mismatched.status).toBe(422);

    const generated = await stack.call("reporting.school-report-card-generate", {
      cookie: admin,
      body: { studentId, termId: foreignTermId },
    });
    expect(generated.status).toBe(422);

    const unknown = await stack.call("reporting.school-report-card-preview", {
      cookie: admin,
      body: { studentId, termId: "term_missing" },
    });
    expect(unknown.status).toBe(404);
  });

  it("reports an unenrolled pupil as 422 to an entitled caller, but 403 to anyone else", async () => {
    const loose = await create("people.student-create", {
      collegeId,
      admissionNo: `RCL-${suffix}`,
      fullName: "Unenrolled Pupil",
    });

    const entitled = await stack.call("reporting.school-report-card-preview", {
      cookie: admin,
      body: { studentId: loose.id, termId },
    });
    expect(entitled.status).toBe(422);

    // The unenrolled answer must not be reachable without authorization:
    // otherwise walking ids distinguishes "no such pupil" from "exists but
    // unenrolled", which is a membership oracle over the student roll.
    const unentitled = await stack.call("reporting.school-report-card-preview", {
      cookie: outsider,
      body: { studentId: loose.id, termId },
    });
    expect(unentitled.status).toBe(403);

    const unknown = await stack.call("reporting.school-report-card-preview", {
      cookie: outsider,
      body: { studentId: "stu_does-not-exist", termId },
    });
    // An id that exists-but-unenrolled and one that does not exist must look
    // the same to an unauthorized caller... except that a truly absent record
    // cannot be authorized against at all, so 404 is unavoidable there. What
    // matters is that 422 — the informative answer — is never given away.
    expect(unknown.status).toBe(404);
    expect(unentitled.status).not.toBe(422);
  });

  it("lists another class's roster without leaking this class's snapshots", async () => {
    const listed = (await (await roster(admin, otherClassId)).json()) as {
      students: { studentId: string; snapshotId: string | null }[];
    };
    expect(listed.students.map((student) => student.studentId)).toEqual([otherStudentId]);
    expect(listed.students[0]!.snapshotId).toBeNull();
  });

  it("publishes a chosen immutable snapshot, supersedes it, and withdraws family access", async () => {
    const firstResponse = await generate(admin);
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json()) as { snapshotId: string };
    const invited = await stack.call("people.guardian-invitation-issue", {
      cookie: admin, params: { studentId }, body: {
        guardianName: "Leela Nair", relationshipType: "parent", contactMethod: "email",
        contactValue: `leela-${randomUUID()}@example.test`,
      },
    });
    expect(invited.status, await invited.clone().text()).toBe(201);
    const { code } = (await invited.json()) as { code: string };
    const username = `rc-parent-${randomUUID().slice(0, 8)}`;
    const activated = await stack.call("people.guardian-activate", {
      body: { code, fullName: "Leela Nair", username, password: "report-parent-pass-123" },
    });
    expect(activated.status).toBe(201);
    const parent = await stack.login(username, "report-parent-pass-123");
    const list = (student = studentId) => stack.call("reporting.child-report-cards", { cookie: parent, params: { studentId: student } });
    const familyPdf = (snapshotId: string, student = studentId) => stack.call("reporting.child-report-card-download", { cookie: parent, params: { studentId: student, snapshotId } });
    const change = (cookie: string, snapshotId: string, action: "publish" | "withdraw") => stack.call(`reporting.school-report-card-${action}`, { cookie, params: { snapshotId } });

    expect(await (await list()).json()).toEqual({ reportCards: [] });
    expect((await familyPdf(first.snapshotId)).status).toBe(403);
    expect((await change(teacher, first.snapshotId, "publish")).status).toBe(403);
    expect((await change(outsider, first.snapshotId, "publish")).status).toBe(403);
    // Privileged admin identities cannot be linked to a teacher record, so
    // the old synthetic mixed-role account is no longer a valid fixture.
    expect((await change(admin, first.snapshotId, "publish")).status).toBe(200);
    const published = (await (await list()).json()) as { reportCards: { snapshotId: string; overall: { percentage: number | null } }[] };
    expect(published.reportCards).toEqual([expect.objectContaining({ snapshotId: first.snapshotId })]);
    const downloaded = await familyPdf(first.snapshotId);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const second = (await (await generate(admin)).json()) as { snapshotId: string };
    expect((await familyPdf(second.snapshotId)).status).toBe(403);
    expect((await change(admin, second.snapshotId, "publish")).status).toBe(200);
    expect((await familyPdf(first.snapshotId)).status).toBe(403);
    expect(((await (await list()).json()) as { reportCards: { snapshotId: string }[] }).reportCards.map((card) => card.snapshotId)).toEqual([second.snapshotId]);
    expect((await change(admin, first.snapshotId, "withdraw")).status).toBe(409);
    expect((await change(admin, second.snapshotId, "withdraw")).status).toBe(200);
    expect(await (await list()).json()).toEqual({ reportCards: [] });
    expect((await familyPdf(second.snapshotId)).status).toBe(403);
    expect((await stack.call("reporting.school-report-card-download", { cookie: admin, params: { snapshotId: first.snapshotId } })).status).toBe(200);

    const unrelated = await list(otherStudentId);
    const unknown = await list("stu_does-not-exist");
    expect([unrelated.status, unknown.status]).toEqual([403, 403]);
    expect(await unrelated.json()).toEqual(await unknown.json());
    expect((await stack.call("reporting.child-report-cards", { cookie: admin, params: { studentId } })).status).toBe(403);
    const disclosureAudit = await stack.pool.query(
      "SELECT action FROM sys_audit_log WHERE action IN ('reporting.family-report-cards-viewed', 'reporting.family-report-card-downloaded', 'reporting.school-report-card-published', 'reporting.school-report-card-withdrawn') AND resource_id IN ($1, $2, $3)",
      [studentId, first.snapshotId, second.snapshotId],
    );
    expect(disclosureAudit.rows.map((row) => row.action)).toEqual(expect.arrayContaining([
      "reporting.family-report-cards-viewed", "reporting.family-report-card-downloaded",
      "reporting.school-report-card-published", "reporting.school-report-card-withdrawn",
    ]));
    await expect(stack.pool.query("DELETE FROM rpt_school_report_card_publications WHERE student_id = $1", [studentId])).rejects.toThrow(/append-only/);
  });

  it("after the pupil leaves, a family keeps only the report card released before the exit (ADR-0027 Decision 9)", async () => {
    const before = (await (await generate(admin)).json()) as { snapshotId: string };
    expect((await stack.call("reporting.school-report-card-publish", { cookie: admin, params: { snapshotId: before.snapshotId } })).status).toBe(200);
    const invited = await stack.call("people.guardian-invitation-issue", {
      cookie: admin, params: { studentId }, body: {
        guardianName: "Ravi Nair", relationshipType: "parent", contactMethod: "email",
        contactValue: `ravi-${randomUUID()}@example.test`,
      },
    });
    const { code } = (await invited.json()) as { code: string };
    const username = `rc-left-${randomUUID().slice(0, 8)}`;
    expect((await stack.call("people.guardian-activate", { body: { code, fullName: "Ravi Nair", username, password: "report-left-pass-123" } })).status).toBe(201);
    const parent = await stack.login(username, "report-left-pass-123");
    // The exit, as year-end progression records it: live access ends now, read-only for 90 days.
    await stack.pool.query(
      "UPDATE ppl_student_guardians SET valid_until = now(), historical_access_until = now() + interval '90 days' WHERE student_id = $1 AND status = 'active'",
      [studentId],
    );
    const list = async () => ((await (await stack.call("reporting.child-report-cards", { cookie: parent, params: { studentId } })).json()) as { reportCards: { snapshotId: string }[] }).reportCards.map((card) => card.snapshotId);
    const pdf = (snapshotId: string) => stack.call("reporting.child-report-card-download", { cookie: parent, params: { studentId, snapshotId } });

    expect(await list()).toEqual([before.snapshotId]);
    expect((await pdf(before.snapshotId)).status).toBe(200);
    expect((await stack.call("fees.child-fees", { cookie: parent, params: { studentId } })).status).toBe(403);

    // A release after the exit is not shown, and it replaces the earlier one, so neither is.
    const after = (await (await generate(admin)).json()) as { snapshotId: string };
    expect((await stack.call("reporting.school-report-card-publish", { cookie: admin, params: { snapshotId: after.snapshotId } })).status).toBe(200);
    expect(await list()).toEqual([]);
    expect((await pdf(after.snapshotId)).status).toBe(403);
    expect((await pdf(before.snapshotId)).status).toBe(403);
  });

  it("freezes the school's chosen PDF style on each issued report card", async () => {
    const params = { collegeId, family: "report_card" };
    const current = await stack.call("reporting.school-document-format-get", { cookie: admin, params });
    const { version } = (await current.json()) as { version: number };
    const firstStyle = { schoolName: "Greenfield School", accentColor: "#176A57", footerText: "Term office copy" };
    expect((await stack.call("reporting.school-document-format-save", { cookie: admin, params,
      body: { expectedVersion: version, style: firstStyle } })).status).toBe(200);
    const first = (await (await generate(admin)).json()) as { snapshotId: string };
    const before = await stack.call("reporting.school-report-card-download", { cookie: admin, params: { snapshotId: first.snapshotId } });
    expect(before.status).toBe(200);
    const beforeBytes = Buffer.from(await before.arrayBuffer());

    const secondStyle = { schoolName: "Greenfield Academy", accentColor: "#AA3311", footerText: "Revised office copy" };
    expect((await stack.call("reporting.school-document-format-save", { cookie: admin, params,
      body: { expectedVersion: version + 1, style: secondStyle } })).status).toBe(200);
    const after = await stack.call("reporting.school-report-card-download", { cookie: admin, params: { snapshotId: first.snapshotId } });
    expect(Buffer.from(await after.arrayBuffer()).equals(beforeBytes)).toBe(true);
    const second = (await (await generate(admin)).json()) as { snapshotId: string };
    const rows = await stack.pool.query("SELECT id, document_style FROM rpt_school_report_cards WHERE id = ANY($1)", [[first.snapshotId, second.snapshotId]]);
    expect(rows.rows.find((row) => row.id === first.snapshotId)?.document_style).toEqual(firstStyle);
    expect(rows.rows.find((row) => row.id === second.snapshotId)?.document_style).toEqual(secondStyle);
  });
});
