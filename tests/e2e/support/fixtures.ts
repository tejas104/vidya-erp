import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type APIRequestContext, type Page, expect, request } from "@playwright/test";

const execFileAsync = promisify(execFile);

/**
 * Demo-seed credentials (scripts/seed-demo.ts). Every journey logs in for
 * real — browser form for UI flows, the login endpoint for API-only checks.
 * Passwords are the seed's fixed demo values (>=12 chars, the policy floor).
 */
export const CREDS = {
  admin: { username: "demo-admin", password: "demo-admin-pass-2026!" },
  principal: { username: "demo-principal", password: "demo-staff-pass-2026!" },
  hod: { username: "demo-hod-cse", password: "demo-staff-pass-2026!" },
  // Data Structures teacher for FY BSc CS — "own subject".
  teacher: { username: "demo-teacher-ds", password: "demo-teacher-pass-2026!" },
  // A different subject's teacher in the same class — "another teacher's subject".
  teacherOther: { username: "demo-teacher-mth", password: "demo-teacher-pass-2026!" },
  classTeacher: { username: "demo-ct-fycs", password: "demo-teacher-pass-2026!" },
  classTeacherOther: { username: "demo-ct-sycs", password: "demo-teacher-pass-2026!" },
  student: { username: "demo-student", password: "demo-student-pass-2026!" },
  accountant: { username: "demo-accountant", password: "demo-accountant-pass-2026!" },
} as const;

export type RoleKey = keyof typeof CREDS;
export const YEAR = "2026-27";

/** Every login in this suite gets its own synthetic source IP so the per-IP
 *  login rate limiter never sees more than one login per bucket. Range is
 *  10.77.x.x — distinct from security.spec's dedicated 10.99.10.* buckets. */
let xffCounter = 0;
function nextXff(): string {
  xffCounter += 1;
  return `10.77.${(xffCounter >> 8) & 0xff}.${xffCounter & 0xff}`;
}

/**
 * Secondary fallback: unique-per-login XFF isolates the per-IP bucket, but
 * the per-username limiter (5/60s, no backoff — RATE_LIMIT_LOGIN_USERNAME_*)
 * is keyed on the account alone, so a busy suite logging into the same demo
 * account (e.g. "admin") repeatedly within a minute can still trip it. This
 * suite always logs in with the correct password, so clearing these keys
 * before each attempt cannot mask a real auth failure — it only stops the
 * account's own request volume from rate-limiting itself. Best-effort: if
 * docker/redis isn't reachable this way, the login below still proceeds.
 */
async function resetLoginThrottle(username: string): Promise<void> {
  const keys = [`ratelimit:login-user:${username}`, `idn:throttle:login:${username}`];
  try {
    await execFileAsync("docker", ["compose", "exec", "-T", "redis", "redis-cli", "DEL", ...keys]);
  } catch {
    // best-effort only — see comment above.
  }
}

/**
 * College 2 (Northgate Junior College / DEMO2) logins — Assignment #11.5
 * Part 1a fixture (seed commit 004614b). Deliberately NOT part of `CREDS`
 * (and so not part of `RoleKey`): the role-gate MATRIX in
 * negative-scope.spec.ts is `Record<RoleKey, Forbidden>` and must stay
 * closed over the 7 college-1 roles it already covers. `apiSession` accepts
 * these as a raw {username, password} pair, mirroring `browserLogin` below.
 */
export const COLLEGE2_CREDS = {
  hod: { username: "demo2-hod-gen", password: "demo-staff-pass-2026!" },
  teacher: { username: "demo2-teacher-eng", password: "demo-teacher-pass-2026!" },
  classTeacher: { username: "demo2-ct-fygn", password: "demo-teacher-pass-2026!" },
} as const;

/** Real HTTP login: returns an APIRequestContext carrying the session cookie.
 *  No in-process shortcut — this is the same endpoint the browser form calls.
 *  Accepts a RoleKey (college-1 demo roles) or a raw {username, password}
 *  (e.g. a COLLEGE2_CREDS entry) — same either-form as browserLogin. */
export async function apiSession(
  baseURL: string,
  role: RoleKey | { username: string; password: string },
): Promise<APIRequestContext> {
  const creds = typeof role === "string" ? CREDS[role] : role;
  await resetLoginThrottle(creds.username);
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": nextXff() } });
  const res = await ctx.post("/api/v1/identity/auth/login", { data: creds });
  expect(res.status(), `login as ${typeof role === "string" ? role : creds.username}`).toBe(200);
  return ctx;
}

/** Log in as `role` (or a raw {username, password} — e.g. a freshly issued
 *  credential no RoleKey exists for) through the real browser login form.
 *  Resolves once the app has navigated away from /login (dashboard / portal
 *  / fees). Same throttle-reset + unique-XFF machinery either way. */
export async function browserLogin(page: Page, role: RoleKey | { username: string; password: string }): Promise<void> {
  const { username, password } = typeof role === "string" ? CREDS[role] : role;
  await resetLoginThrottle(username);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": nextXff() });
  await page.goto("/login");
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click(".login-submit");
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20_000 });
}

export interface DemoIds {
  collegeId: string;
  classId: string;
  sectionId: string;
  otherSectionId: string;
  ownSubjectId: string;
  otherSubjectId: string;
  sectionStudentIds: string[];
  otherSectionStudentId: string;
  hallTicketStudentId: string;
  /** Containment decoy (seed commit 004614b): the MSC department's FYMS
   *  "Section A" — same section letter as FYCS-A, but a different
   *  department entirely. A student here is outside every CSE-scoped
   *  grant (hod/teacher/class_teacher), so reading it proves narrower-than-
   *  college containment rather than just "some grant exists". */
  otherDeptSectionId: string;
  otherDeptStudentId: string;
}

interface TreeSubject { id: string; code: string }
interface TreeSection { id: string; name: string }
interface TreeClass { id: string; code: string; sections: TreeSection[] }
interface TreeDept { id: string; code: string; classes: TreeClass[]; subjects: TreeSubject[] }
interface Tree { college: { id: string }; departments: TreeDept[] }

/** Resolves the demo college's structure (CSE dept, FY/SY CS classes, DS/MTH
 *  subjects, section rosters) so journeys never hardcode volatile seed ids. */
export async function discover(admin: APIRequestContext): Promise<DemoIds> {
  const collegesRes = await admin.get("/api/v1/people/colleges");
  expect(collegesRes.ok(), "list colleges").toBeTruthy();
  const { colleges } = (await collegesRes.json()) as { colleges: { id: string; code: string }[] };
  const collegeId = (colleges.find((c) => c.code === "DEMO") ?? colleges[0]!).id;

  const treeRes = await admin.get(`/api/v1/people/colleges/${encodeURIComponent(collegeId)}/tree`);
  expect(treeRes.ok(), "college tree").toBeTruthy();
  const tree = (await treeRes.json()) as Tree;

  const cse = tree.departments.find((d) => d.code === "CSE") ?? tree.departments[0]!;
  const byClassCode = (code: string) => cse.classes.find((c) => c.code === code);
  const fy = byClassCode("FYCS") ?? cse.classes[0]!;
  const sy = byClassCode("SYCS") ?? cse.classes[1] ?? cse.classes[0]!;
  // Seed subject codes are class-suffixed (e.g. "DS-FYCS", "MTH-FYCS").
  const subject = (prefix: string) => cse.subjects.find((s) => s.code.startsWith(prefix)) ?? cse.subjects[0]!;

  const sectionId = fy.sections[0]!.id;
  const otherSectionId = sy.sections[0]!.id;

  const roster = async (secId: string): Promise<string[]> => {
    const res = await admin.get(`/api/v1/people/sections/${encodeURIComponent(secId)}/roster`);
    expect(res.ok(), `roster ${secId}`).toBeTruthy();
    const { students } = (await res.json()) as { students: { id: string }[] };
    return students.map((s) => s.id);
  };
  const sectionStudentIds = await roster(sectionId);
  const otherRoster = await roster(otherSectionId);

  // Decoy department (seed commit 004614b): MSC / FYMS / "Section A" — same
  // section letter as FYCS-A, deliberately outside CSE. Admin's own
  // college-wide grant already covers it (same `tree` fetch above), so no
  // extra HTTP round trip is needed beyond the roster read.
  const msc = tree.departments.find((d) => d.code === "MSC") ?? tree.departments[1] ?? cse;
  const fyms = msc.classes.find((c) => c.code === "FYMS") ?? msc.classes[0]!;
  const otherDeptSectionId = fyms.sections[0]!.id;
  const otherDeptRoster = await roster(otherDeptSectionId);

  return {
    collegeId,
    classId: fy.id,
    sectionId,
    otherSectionId,
    ownSubjectId: subject("DS-").id,
    otherSubjectId: subject("MTH-").id,
    sectionStudentIds,
    otherSectionStudentId: otherRoster[0]!,
    hallTicketStudentId: sectionStudentIds[0]!,
    otherDeptSectionId,
    otherDeptStudentId: otherDeptRoster[0]!,
  };
}

/**
 * College 2 (Northgate Junior College / DEMO2) ids — Assignment #11.5 Part 1b.
 *
 * There is deliberately no college-wide-scoped login for college 2 to
 * discover it with (see the seed script's own comment above the college-2
 * block in scripts/seed-demo.ts: after seeding, demo-admin holds exactly its
 * original DEMO grant — zero standing in DEMO2). So this resolves ids the
 * same way any *legitimate* college-2 principal would — each account reading
 * only its own data — never a hardcoded UUID:
 *   - demo2-teacher-eng's own session grant names their college + class;
 *     their own class's assessments/marks name a real student (the one the
 *     seed entered real marks for, so the marks containment case has a real
 *     row to filter away).
 *   - demo2-hod-gen's own pending-approvals queue names a real, still-
 *     pending leave request (the seed leaves it undecided on purpose).
 */
export interface College2Ids {
  collegeId: string;
  classId: string;
  studentId: string;
  pendingLeaveRequestId: string;
}

export async function discoverCollege2(baseURL: string): Promise<College2Ids> {
  const teacher = await apiSession(baseURL, COLLEGE2_CREDS.teacher);
  const sessionRes = await teacher.get("/api/v1/identity/auth/session");
  expect(sessionRes.ok(), "college2 teacher session").toBeTruthy();
  const session = (await sessionRes.json()) as { grants: { org: { collegeId: string; classId?: string } }[] };
  const org = session.grants[0]?.org;
  expect(org?.classId, "college2 teacher grant has a classId").toBeTruthy();
  const collegeId = org!.collegeId;
  const classId = org!.classId!;

  const assessmentsRes = await teacher.get(`/api/v1/academics/classes/${encodeURIComponent(classId)}/assessments`);
  expect(assessmentsRes.ok(), "college2 class assessments").toBeTruthy();
  const { assessments } = (await assessmentsRes.json()) as { assessments: { id: string }[] };
  expect(assessments.length, "college2 has a seeded assessment").toBeGreaterThan(0);

  const marksRes = await teacher.get(`/api/v1/academics/assessments/${encodeURIComponent(assessments[0]!.id)}/marks`);
  expect(marksRes.ok(), "college2 assessment marks").toBeTruthy();
  const { marks } = (await marksRes.json()) as { marks: { studentId: string }[] };
  expect(marks.length, "college2 assessment has real marks").toBeGreaterThan(0);
  const studentId = marks[0]!.studentId;
  await teacher.dispose();

  const hod = await apiSession(baseURL, COLLEGE2_CREDS.hod);
  const pendingRes = await hod.get("/api/v1/leave/pending");
  expect(pendingRes.ok(), "college2 hod pending leave").toBeTruthy();
  const { requests } = (await pendingRes.json()) as { requests: { id: string; status: string }[] };
  const pending = requests.find((r) => r.status === "pending");
  expect(pending, "college2 has a pending leave request").toBeTruthy();
  const pendingLeaveRequestId = pending!.id;
  await hod.dispose();

  return { collegeId, classId, studentId, pendingLeaveRequestId };
}

/** Poll a report to completion and return its final status row. */
export async function pollReport(
  ctx: APIRequestContext,
  reportId: string,
  timeoutMs = 30_000,
): Promise<{ status: string; rows: number }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await ctx.get(`/api/v1/reports/${encodeURIComponent(reportId)}`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { status: string; rows: number };
    if (body.status === "completed" || body.status === "failed") return body;
    if (Date.now() > deadline) throw new Error(`report ${reportId} stuck at ${body.status}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
