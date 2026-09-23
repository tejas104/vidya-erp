import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

/**
 * Guardian access (ADR-0027) over real Postgres, real sessions, the real
 * route gate and the real scope checker.
 *
 * What this proves that unit tests cannot: that a guardian principal really
 * is refused by routes that were written before guardians existed (the route
 * audience gate, Finding C); that the invitation claim is atomic in the
 * database; that the code never reaches the audit log; and that the table
 * itself refuses an unverified other-authorized-contact.
 */

let stack: Stack;
let admin: string;
let collegeId: string;
let classId: string;
let studentId: string;
let otherStudentId: string;
let classTeacher: string;
let outsider: string;

const suffix = randomUUID().slice(0, 8);
const academicYear = "2026-27";
const PASSWORD = "guardian-chosen-pass-1";

async function create(route: string, body: unknown, params?: Record<string, string>) {
  const response = await stack.call(route, { cookie: admin, body, params });
  expect(response.status, `${route}: ${await response.clone().text()}`).toBe(201);
  return (await response.json()) as { id: string };
}

async function provisionStaff(prefix: string, classTeacherOf?: string): Promise<string> {
  const username = `${prefix}-${randomUUID().slice(0, 8)}`;
  const user = await create("identity.user-create", { username, displayName: username, collegeId, temporaryPassword: "temporary-pass-123", roles: [] });
  const reset = await stack.call("identity.password-reset-init", { cookie: admin, params: { userId: user.id } });
  const { token } = (await reset.json()) as { token: string };
  expect((await stack.call("identity.password-reset-confirm", { body: { token, newPassword: "staff-pass-12345" } })).status).toBe(200);
  if (classTeacherOf !== undefined) {
    const person = await create("people.teacher-create", { collegeId, staffNo: username, fullName: username });
    await stack.call("people.teacher-link-identity", { cookie: admin, params: { teacherId: person.id }, body: { identityUserId: user.id } });
    await create("people.assignment-create", { classId: classTeacherOf, academicYear, kind: "class_teacher" }, { teacherId: person.id });
  }
  return stack.login(username, "staff-pass-12345");
}

async function invite(cookie: string, student: string, overrides: Record<string, unknown> = {}) {
  return stack.call("people.guardian-invitation-issue", {
    cookie,
    params: { studentId: student },
    body: {
      guardianName: "Meera Kulkarni",
      relationshipType: "parent",
      contactMethod: "sms",
      contactValue: `+91-9${randomUUID().replace(/\D/g, "").slice(0, 9)}`,
      ...overrides,
    },
  });
}

async function issuedCode(cookie: string, student: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await invite(cookie, student, overrides);
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { code: string }).code;
}

async function activate(code: string, username = `parent-${randomUUID().slice(0, 8)}`) {
  const response = await stack.call("people.guardian-activate", {
    body: { code, fullName: "Meera Kulkarni", username, password: PASSWORD },
    ip: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
  return { response, username };
}

beforeAll(async () => {
  stack = buildStack("school");
  const bootstrap = await stack.bootstrap();
  admin = bootstrap.adminCookie;
  collegeId = bootstrap.collegeId;
  const { departmentId } = await stack.people.service.ensureImplicitDepartment(collegeId);
  classId = (await create("people.class-create", { departmentId, name: `Std G ${suffix}`, code: `G-${suffix}` })).id;
  const otherClassId = (await create("people.class-create", { departmentId, name: `Std GO ${suffix}`, code: `GO-${suffix}` })).id;
  const sectionId = (await create("people.section-create", { classId, name: "A" })).id;
  const otherSectionId = (await create("people.section-create", { classId: otherClassId, name: "A" })).id;
  studentId = (await create("people.student-create", { collegeId, admissionNo: `G-${suffix}`, fullName: "Asha Kulkarni" })).id;
  otherStudentId = (await create("people.student-create", { collegeId, admissionNo: `GO-${suffix}`, fullName: "Ravi Deshmukh" })).id;
  await stack.call("people.student-enroll", { cookie: admin, body: { sectionId, academicYear }, params: { studentId } });
  await stack.call("people.student-enroll", { cookie: admin, body: { sectionId: otherSectionId, academicYear }, params: { studentId: otherStudentId } });
  classTeacher = await provisionStaff("g-ct", classId);
  outsider = await provisionStaff("g-out");
});

afterAll(async () => {
  await stack?.close();
});

describe("Guardian access over real Postgres", () => {
  let guardian: string;
  let guardianUsername: string;

  it("issues a code once, and never writes it to the audit log", async () => {
    const response = await invite(admin, studentId);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { code, invitation } = (await response.json()) as { code: string; invitation: { id: string } };
    expect(code).toMatch(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);

    const rows = await stack.pool.query(
      "SELECT details::text AS details FROM sys_audit_log WHERE action = 'people.guardian-invited' AND details->>'invitationId' = $1",
      [invitation.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].details).not.toContain(code.replace(/-/g, ""));
    expect(rows.rows[0].details).not.toContain(code);

    const activated = await activate(code);
    expect(activated.response.status, await activated.response.clone().text()).toBe(201);
    expect(await activated.response.json()).toMatchObject({ child: { fullName: "Asha Kulkarni" }, status: "active" });
    guardianUsername = activated.username;
    guardian = await stack.login(guardianUsername, PASSWORD);
  });

  it("records the activation with a guardian actor, not a staff one", async () => {
    const rows = await stack.pool.query(
      "SELECT actor_type FROM sys_audit_log WHERE action = 'people.guardian-activated' ORDER BY occurred_at DESC LIMIT 1",
    );
    expect(rows.rows[0].actor_type).toBe("guardian");
  });

  it("signs the guardian in as a guardian principal with no roles", async () => {
    const whoami = await stack.call("identity.session", { cookie: guardian });
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({ kind: "guardian", roles: [], grants: [] });
  });

  it("shows the guardian exactly their own child", async () => {
    const response = await stack.call("people.guardian-children", { cookie: guardian });
    expect(response.status).toBe(200);
    const { children } = (await response.json()) as { children: { studentId: string; status: string }[] };
    expect(children).toEqual([expect.objectContaining({ studentId, status: "active" })]);
  });

  it("serves the family portal for the guardian's own child, and refuses staff on it", async () => {
    const read = (cookie: string, view: string, student = studentId) =>
      stack.call(`portal.child-${view}`, { cookie, params: { studentId: student }, query: { academicYear } });
    const attendance = await read(guardian, "attendance");
    expect(attendance.status, await attendance.clone().text()).toBe(200);
    // No register taken yet: an absence of records, never a 0% figure.
    expect(await attendance.json()).toMatchObject({ pct: null, counts: { present: 0, absent: 0, late: 0, excused: 0 } });
    expect((await read(guardian, "marks")).status).toBe(200);
    expect((await read(guardian, "timetable")).status).toBe(200);

    expect((await read(guardian, "attendance", otherStudentId)).status).toBe(403);
    expect((await read(admin, "attendance")).status).toBe(403);
  });

  it("refuses the guardian on staff routes — including ones open to 'any authenticated' staff", async () => {
    const statuses = await Promise.all([
      stack.call("people.college-list", { cookie: guardian }),
      stack.call("people.student-get", { cookie: guardian, params: { studentId } }),
      stack.call("people.student-guardians", { cookie: guardian, params: { studentId } }),
      stack.call("identity.user-list", { cookie: guardian, query: { collegeId } }),
    ]);
    expect(statuses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
  });

  it("refuses staff on guardian routes", async () => {
    expect((await stack.call("people.guardian-children", { cookie: admin })).status).toBe(403);
    expect((await stack.call("people.guardian-children", { cookie: classTeacher })).status).toBe(403);
  });

  it("will not give the guardian account a staff role", async () => {
    const whoami = (await (await stack.call("identity.session", { cookie: guardian })).json()) as { userId: string };
    const response = await stack.call("identity.roles-set", { cookie: admin, params: { userId: whoami.userId }, body: { roles: ["admin"] } });
    expect(response.status).toBe(409);
  });

  it("refuses a spent code and an unknown code identically", async () => {
    const code = await issuedCode(admin, studentId);
    expect((await activate(code)).response.status).toBe(201);
    const spent = await activate(code);
    const unknown = await activate("AAAAA-BBBBB-CCCCC-DDDDD");
    expect([spent.response.status, unknown.response.status]).toEqual([400, 400]);
    expect(await spent.response.json()).toEqual(await unknown.response.json());
  });

  it("lets the class teacher invite for their own class only, and never revoke", async () => {
    expect((await invite(classTeacher, studentId)).status).toBe(201);
    expect((await invite(classTeacher, otherStudentId)).status).toBe(403);
    expect((await invite(outsider, studentId)).status).toBe(403);

    const list = await stack.call("people.student-guardians", { cookie: classTeacher, params: { studentId } });
    expect(list.status).toBe(200);
    const { relationships } = (await list.json()) as { relationships: { id: string }[] };
    const revoke = await stack.call("people.guardian-relationship-revoke", {
      cookie: classTeacher,
      params: { relationshipId: relationships[0]!.id },
      body: { reason: "trying to revoke" },
    });
    expect(revoke.status).toBe(403);
  });

  it("links a second child to the same guardian by redeeming while signed in", async () => {
    const code = await issuedCode(admin, otherStudentId);
    const response = await stack.call("people.guardian-redeem", { cookie: guardian, body: { code } });
    expect(response.status, await response.clone().text()).toBe(201);
    const { children } = (await (await stack.call("people.guardian-children", { cookie: guardian })).json()) as { children: { studentId: string }[] };
    expect(children.map((child) => child.studentId).sort()).toEqual([studentId, otherStudentId].sort());
  });

  it("revocation removes one child on the next request, leaving the other", async () => {
    const whoami = (await (await stack.call("identity.session", { cookie: guardian })).json()) as { userId: string };
    const own = await stack.pool.query(
      `SELECT sg.id FROM ppl_student_guardians sg JOIN ppl_guardians g ON g.id = sg.guardian_id
        WHERE g.identity_user_id = $1 AND sg.student_id = $2`,
      [whoami.userId, studentId],
    );
    const revoke = await stack.call("people.guardian-relationship-revoke", {
      cookie: admin,
      params: { relationshipId: own.rows[0].id },
      body: { reason: "custody order on file" },
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ relationship: { status: "revoked", statusReason: "custody order on file" } });

    // The guardian's session was not touched; their very next request sees it.
    const { children } = (await (await stack.call("people.guardian-children", { cookie: guardian })).json()) as { children: { studentId: string }[] };
    expect(children.map((child) => child.studentId)).toEqual([otherStudentId]);
    const revokedRead = await stack.call("portal.child-attendance", { cookie: guardian, params: { studentId }, query: { academicYear } });
    const keptRead = await stack.call("portal.child-attendance", { cookie: guardian, params: { studentId: otherStudentId }, query: { academicYear } });
    expect([revokedRead.status, keptRead.status]).toEqual([403, 200]);
  });

  it("holds an other-authorized-contact pending until staff verify, in the database itself", async () => {
    const code = await issuedCode(admin, otherStudentId, { relationshipType: "other-authorized-contact" });
    const activated = await activate(code);
    expect(await activated.response.json()).toMatchObject({ status: "pending" });

    const pending = (await (await stack.call("people.student-guardians", { cookie: admin, params: { studentId: otherStudentId } })).json()) as {
      relationships: { id: string; relationshipType: string; status: string }[];
    };
    const contact = pending.relationships.find((relationship) => relationship.relationshipType === "other-authorized-contact")!;
    await expect(
      stack.pool.query("UPDATE ppl_student_guardians SET status = 'active' WHERE id = $1", [contact.id]),
    ).rejects.toThrow(/ppl_sg_contact_verified_check/);

    const verified = await stack.call("people.guardian-relationship-verify", { cookie: admin, params: { relationshipId: contact.id } });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ relationship: { status: "active", verificationState: "staff-verified", categories: ["attendance", "notices", "timetable"] } });
  });
});
