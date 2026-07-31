import { type APIRequestContext, type Page, expect, request } from "@playwright/test";

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

/** Real HTTP login: returns an APIRequestContext carrying the session cookie.
 *  No in-process shortcut — this is the same endpoint the browser form calls. */
export async function apiSession(baseURL: string, role: RoleKey): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/v1/identity/auth/login", { data: CREDS[role] });
  expect(res.status(), `login as ${role}`).toBe(200);
  return ctx;
}

/** Log in as `role` through the real browser login form. Resolves once the
 *  app has navigated away from /login (dashboard / portal / fees). */
export async function browserLogin(page: Page, role: RoleKey): Promise<void> {
  const { username, password } = CREDS[role];
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
  };
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
