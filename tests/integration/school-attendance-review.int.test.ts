import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

let stack: Stack;
let admin: string;
let collegeId: string;
let sectionId: string;
let termId: string;
let pupilA: string;
let pupilB: string;
const year = "2026-27";
const suffix = randomUUID().slice(0, 8);
const days = ["2026-09-21", "2026-09-22", "2026-09-23"];

async function create(route: string, body: unknown) {
  const response = await stack.call(route, { cookie: admin, body });
  expect(response.status, `${route}: ${await response.clone().text()}`).toBe(201);
  return (await response.json()) as { id: string };
}
async function insertSession(on: string, slot: string, subjectId: string, entries: { studentId: string; status: string }[]) {
  const id = `ses_${randomUUID()}`;
  const path = await stack.people.service.directory.sectionPath(sectionId);
  if (!path?.departmentId || !path.classId) throw new Error("section path missing");
  await stack.pool.query("INSERT INTO acd_attendance_sessions (id,section_id,subject_id,held_on,slot,academic_year,taken_by,college_id,department_id,class_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, sectionId, subjectId, on, slot, year, "fixture", collegeId, path.departmentId, path.classId]);
  for (const entry of entries) await stack.pool.query("INSERT INTO acd_attendance_entries (id,session_id,student_id,status) VALUES ($1,$2,$3,$4)", [`ate_${randomUUID()}`, id, entry.studentId, entry.status]);
}

beforeAll(async () => {
  stack = buildStack("school");
  const bootstrap = await stack.bootstrap();
  admin = bootstrap.adminCookie; collegeId = bootstrap.collegeId;
  const { departmentId } = await stack.people.service.ensureImplicitDepartment(collegeId);
  const schoolClass = await create("people.class-create", { departmentId, name: `Review ${suffix}`, code: `AR-${suffix}` });
  sectionId = (await create("people.section-create", { classId: schoolClass.id, name: "A" })).id;
  pupilA = (await create("people.student-create", { collegeId, admissionNo: `AR-A-${suffix}`, fullName: "Asha Rao" })).id;
  pupilB = (await create("people.student-create", { collegeId, admissionNo: `AR-B-${suffix}`, fullName: "Bela Sen" })).id;
  for (const studentId of [pupilA, pupilB]) expect((await stack.call("people.student-enroll", { cookie: admin, params: { studentId }, body: { sectionId, academicYear: year } })).status).toBe(200);
  termId = (await create("school-academics.create", { collegeId, name: `Review ${suffix}`, academicYear: year, startsOn: "2026-09-01", endsOn: "2026-12-31" })).id;
});
afterAll(async () => { await stack?.close(); });

describe("school attendance review with real database and authorization", () => {
  it("requires login and an explicit calendar, rejects invalid dates and stale updates", async () => {
    expect((await stack.call("school-academics.attendance-shortfall", { params: { sectionId }, query: { termId } })).status).toBe(401);
    expect((await stack.call("school-academics.attendance-shortfall", { cookie: admin, params: { sectionId }, query: { termId } })).status).toBe(409);
    const set = (instructionalDays: string[], expectedVersion = 0) => stack.call("school-academics.calendar-set", { cookie: admin, params: { termId }, body: { instructionalDays, shortfallThreshold: 75, expectedVersion } });
    expect((await set([days[0]!, days[0]!])).status).toBe(422);
    expect((await set(["2027-01-01"])).status).toBe(422);
    const saved = await set(days);
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await saved.json()).toMatchObject({ instructionalDays: days, shortfallThreshold: 75, version: 1 });
    expect((await set(days)).status).toBe(409);
  });

  it("does not count subject periods as daily registers or missing registers as absence", async () => {
    const subject = await create("people.subject-create", { departmentId: (await stack.people.service.directory.sectionPath(sectionId))!.departmentId, name: `Math ${suffix}`, code: `ARM-${suffix}` });
    await insertSession(days[0]!, "day", "", [{ studentId: pupilA, status: "present" }, { studentId: pupilB, status: "absent" }]);
    await insertSession(days[1]!, "p1", subject.id, [{ studentId: pupilA, status: "present" }, { studentId: pupilB, status: "present" }]);
    let response = await stack.call("school-academics.attendance-shortfall", { cookie: admin, params: { sectionId }, query: { termId, through: days[2]! } });
    expect(response.status, await response.clone().text()).toBe(200);
    let result = await response.json() as { unsubmittedDates: string[]; students: { studentId: string; absentDays: number; percentage: number | null; shortfall: boolean | null }[] };
    expect(result.unsubmittedDates).toEqual([days[1], days[2]]);
    expect(result.students.find((student) => student.studentId === pupilB)).toMatchObject({ absentDays: 1, percentage: null, shortfall: null });
    await insertSession(days[1]!, "day", "", [{ studentId: pupilA, status: "present" }]);
    await insertSession(days[2]!, "day", "", [{ studentId: pupilA, status: "present" }, { studentId: pupilB, status: "absent" }]);
    response = await stack.call("school-academics.attendance-shortfall", { cookie: admin, params: { sectionId }, query: { termId, through: days[2]! } });
    result = await response.json();
    expect(result.unsubmittedDates).toEqual([]);
    expect(result.students.find((student) => student.studentId === pupilA)).toMatchObject({ percentage: 100, shortfall: false });
    expect(result.students.find((student) => student.studentId === pupilB)).toMatchObject({ absentDays: 2, percentage: null, shortfall: null });
  });
});
