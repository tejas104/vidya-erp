/// <reference lib="dom" />
import { request, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** Synthetic, local-only school fixture created through the same HTTP API as the UI. */
const baseURL = "http://localhost:3125";
const academicYear = "2026-27";
const adminCredentials = { username: "school-demo-admin", password: "school-demo-admin-pass-2026" };
const teacherCredentials = { username: "school-demo-teacher", password: "school-demo-teacher-pass-2026" };
const classTeacherCredentials = { username: "school-demo-class-teacher", password: "school-demo-class-pass-2026" };
const principalCredentials = { username: "school-demo-principal", password: "school-demo-principal-pass-2026" };
const studentCredentials = { username: "school-demo-student", password: "school-demo-student-pass-2026" };
const familyCredentials = { username: "school-demo-family", password: "school-demo-family-pass-2026" };
let requestCounter = 0;

async function api<T>(client: APIRequestContext, method: "get" | "post" | "put", path: string, data?: unknown): Promise<T> {
  // Dedicated local fixture source addresses keep rapid setup from exhausting
  // the normal per-IP rate-limit window; the running app's policy is unchanged.
  requestCounter += 1;
  const options = { headers: { "x-forwarded-for": `10.78.${Math.floor(requestCounter / 250)}.${requestCounter % 250 + 1}` }, ...(data === undefined ? {} : { data }) };
  const response = await client[method](path, options);
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`);
  return await response.json() as T;
}

async function login(credentials: { username: string; password: string }): Promise<APIRequestContext> {
  const client = await request.newContext({ baseURL });
  await api(client, "post", "/api/v1/identity/auth/login", credentials);
  return client;
}

async function main(): Promise<void> {
  if (process.env.SCHOOL_DEMO_SEED !== "true") throw new Error("Set SCHOOL_DEMO_SEED=true to seed the local demo");
  const admin = await login(adminCredentials);
  try {
    const { colleges } = await api<{ colleges: { id: string; code: string }[] }>(admin, "get", "/api/v1/people/colleges");
    const college = colleges.find((item) => item.code === "VDEMO");
    if (!college || colleges.length !== 1) throw new Error("Expected only the VDEMO school in the isolated demo database");
    const collegeId = college.id;
    const { departments } = await api<{ departments: { id: string; classes: { code: string }[] }[] }>(admin, "get", `/api/v1/people/colleges/${collegeId}/tree`);
    if (departments.length !== 1) throw new Error("Expected the one implicit school department");
    const departmentId = departments[0]!.id;
    if (departments[0]!.classes.length !== 0) throw new Error("School demo has already been seeded; refusing to create duplicates");

    const { id: classId } = await api<{ id: string }>(admin, "post", "/api/v1/people/classes", { departmentId, name: "Standard 8", code: "STD8" });
    const { id: sectionId } = await api<{ id: string }>(admin, "post", "/api/v1/people/sections", { classId, name: "A" });
    const subjects = [] as { id: string; name: string }[];
    for (const [name, code] of [["Mathematics", "MATH8"], ["Science", "SCI8"]] as const) {
      const { id } = await api<{ id: string }>(admin, "post", "/api/v1/people/subjects", { departmentId, name, code });
      subjects.push({ id, name });
    }
    const students = [] as { id: string; name: string }[];
    for (const [index, name] of ["Asha Sharma", "Aarav Mehta", "Meera Das", "Kabir Roy", "Riya Sen"].entries()) {
      const { id } = await api<{ id: string }>(admin, "post", "/api/v1/people/students", { collegeId, admissionNo: `VDEMO-8A-${String(index + 1).padStart(3, "0")}`, fullName: name });
      await api(admin, "post", `/api/v1/people/students/${id}/enrollment`, { sectionId, academicYear });
      students.push({ id, name });
    }

    const createUser = async (credentials: { username: string; password: string }, displayName: string, roles: string[] = []) => {
      const { id } = await api<{ id: string }>(admin, "post", "/api/v1/identity/users", { collegeId, username: credentials.username, displayName, temporaryPassword: credentials.password, roles });
      await api(admin, "post", `/api/v1/identity/users/${id}/password`, { newPassword: credentials.password });
      return id;
    };
    const teacherUserId = await createUser(teacherCredentials, "Ananya Iyer");
    const { id: teacherId } = await api<{ id: string }>(admin, "post", "/api/v1/people/teachers", { collegeId, fullName: "Ananya Iyer", staffNo: "VDEMO-T-001" });
    await api(admin, "post", `/api/v1/people/teachers/${teacherId}/identity-link`, { identityUserId: teacherUserId });
    for (const subject of subjects) await api(admin, "post", `/api/v1/people/teachers/${teacherId}/assignments`, { classId, subjectId: subject.id, academicYear, kind: "subject_teacher" });
    const classTeacherUserId = await createUser(classTeacherCredentials, "Farah Khan");
    const { id: classTeacherId } = await api<{ id: string }>(admin, "post", "/api/v1/people/teachers", { collegeId, fullName: "Farah Khan", staffNo: "VDEMO-T-002" });
    await api(admin, "post", `/api/v1/people/teachers/${classTeacherId}/identity-link`, { identityUserId: classTeacherUserId });
    await api(admin, "post", `/api/v1/people/teachers/${classTeacherId}/assignments`, { classId, academicYear, kind: "class_teacher" });
    const principalUserId = await createUser(principalCredentials, "Dr. Nisha Rao", ["principal"]);
    await api(admin, "post", `/api/v1/identity/users/${principalUserId}/grants`, { role: "principal", collegeId });
    await api(admin, "put", `/api/v1/timetable/colleges/${collegeId}/periods`, { periods: [
      { periodNo: 1, starts: "09:00", ends: "09:45" },
      { periodNo: 2, starts: "09:50", ends: "10:35" },
      { periodNo: 3, starts: "10:45", ends: "11:30" },
    ] });
    for (let dayOfWeek = 1; dayOfWeek <= 6; dayOfWeek++) {
      for (const [index, subject] of subjects.entries()) {
        await api(admin, "post", "/api/v1/timetable/entries", { sectionId, subjectId: subject.id, teacherId, room: "8A", dayOfWeek, periodNo: index + 1, academicYear });
      }
    }
    const studentUserId = await createUser(studentCredentials, students[0]!.name, ["student"]);
    await api(admin, "post", `/api/v1/people/students/${students[0]!.id}/identity-link`, { identityUserId: studentUserId });

    const { id: termId } = await api<{ id: string }>(admin, "post", "/api/v1/school/terms", { collegeId, name: "Term 1", academicYear, startsOn: "2026-04-01", endsOn: "2026-08-31" });
    await api(admin, "put", `/api/v1/school/terms/${termId}/assessment-types`, { types: [{ name: "Exam", weight: 100 }] });
    await api(admin, "post", "/api/v1/school/terms", { collegeId, name: "Term 2", academicYear, startsOn: "2026-09-01", endsOn: "2026-12-31" });
    const { id: scaleId } = await api<{ id: string }>(admin, "post", "/api/v1/results/scales", { collegeId, name: "School A-E", bands: [
      { minPct: 85, grade: "A", points: 10 }, { minPct: 70, grade: "B", points: 8 },
      { minPct: 55, grade: "C", points: 6 }, { minPct: 40, grade: "D", points: 4 },
      { minPct: 0, grade: "E", points: 0 },
    ] });
    const teacher = await login(teacherCredentials);
    try {
      for (const [index, subject] of subjects.entries()) {
        const { id: unitId } = await api<{ id: string }>(teacher, "post", "/api/v1/syllabus/units", { classId, subjectId: subject.id, academicYear, title: index === 0 ? "Numbers and algebra" : "Living systems", position: 1 });
        const { id: taughtTopicId } = await api<{ id: string }>(teacher, "post", `/api/v1/syllabus/units/${unitId}/topics`, { title: index === 0 ? "Linear equations" : "Cells and tissues", position: 1 });
        await api(teacher, "put", `/api/v1/syllabus/topics/${taughtTopicId}/coverage`, { taughtOn: "2026-08-20" });
        await api(teacher, "post", `/api/v1/syllabus/units/${unitId}/topics`, { title: index === 0 ? "Graphs" : "The human body", position: 2 });
      }
      await api(teacher, "post", "/api/v1/coursework/assignments", { classId, subjectId: subjects[1]!.id, academicYear, title: "Observe a local ecosystem", instructions: "Describe three plants and three animals in your neighbourhood. Submit a short observation note.", dueOn: "2026-10-15", maxScore: 20 });
      const setup = await api<{ terms: { id: string; types: { id: string }[] }[] }>(admin, "get", `/api/v1/school/classes/${classId}/setup?academicYear=${academicYear}`);
      const typeId = setup.terms.find((term) => term.id === termId)?.types[0]?.id;
      if (!typeId) throw new Error("Term 1 assessment type missing");
      for (const [subjectIndex, subject] of subjects.entries()) {
        const { id: assessmentId } = await api<{ id: string }>(teacher, "post", "/api/v1/school/assessments", { classId, subjectId: subject.id, termId, typeId, scaleId, name: `${subject.name} term exam`, maxScore: 100, heldOn: "2026-08-12" });
        await api(teacher, "put", `/api/v1/school/assessments/${assessmentId}/marks`, { entries: students.map((student, index) => ({ studentId: student.id, score: 91 - index * 7 - subjectIndex * 3 })) });
      }
    } finally { await teacher.dispose(); }
    const classTeacher = await login(classTeacherCredentials);
    try {
      await api(classTeacher, "post", "/api/v1/academics/attendance/sessions", { sectionId, heldOn: "2026-08-10", slot: "day", academicYear, entries: students.map((student, index) => ({ studentId: student.id, status: index === 3 ? "absent" : "present" })) });
    } finally { await classTeacher.dispose(); }

    await api(admin, "post", `/api/v1/school/terms/${termId}/close`, {});
    const { id: examSeriesId } = await api<{ id: string }>(admin, "post", "/api/v1/exams/series", { collegeId, name: "Term 2 assessment week", academicYear, term: "Term 2" });
    await api(admin, "post", "/api/v1/exams/slots", { seriesId: examSeriesId, classId, subjectId: subjects[0]!.id, onDate: "2026-11-16", starts: "09:00", ends: "11:00", room: "Hall A" });
    await api(admin, "post", "/api/v1/exams/slots", { seriesId: examSeriesId, classId, subjectId: subjects[1]!.id, onDate: "2026-11-18", starts: "09:00", ends: "11:00", room: "Hall A" });
    const { snapshotId } = await api<{ snapshotId: string }>(admin, "post", "/api/v1/school/report-cards", { studentId: students[0]!.id, termId });
    await api(admin, "post", `/api/v1/school/report-cards/${snapshotId}/publish`, {});
    await api(admin, "post", "/api/v1/notices", { collegeId, audience: `class:${classId}`, title: "Welcome to Standard 8", body: "Term 2 begins in September. Please check your timetable and school notices." });

    const { code } = await api<{ code: string }>(admin, "post", `/api/v1/people/students/${students[0]!.id}/guardian-invitations`, { guardianName: "Leela Sharma", relationshipType: "parent", contactMethod: "email", contactValue: "leela.sharma@example.test" });
    await api(admin, "post", "/api/v1/people/guardian-invitations/activate", { code, fullName: "Leela Sharma", ...familyCredentials });

    const { id: headId } = await api<{ id: string }>(admin, "post", "/api/v1/fees/heads", { collegeId, name: "Tuition" });
    await api(admin, "post", "/api/v1/fees/structures", { classId, headId, academicYear, amountPaise: 120000, dueOn: "2026-10-15", installmentNo: 1 });
    const { runId } = await api<{ runId: string }>(admin, "post", "/api/v1/fees/generate", { classId, academicYear });
    let feeStatus = "pending";
    for (let attempt = 0; attempt < 30; attempt++) {
      const run = await api<{ status: string; error: string | null }>(admin, "get", `/api/v1/fees/generate/${runId}`);
      feeStatus = run.status;
      if (feeStatus === "failed") throw new Error(`Fee generation failed: ${run.error}`);
      if (feeStatus === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (feeStatus !== "completed") throw new Error("Fee generation did not finish within 30 seconds");
    const invoices = await api<{ invoices: { id: string }[] }>(admin, "get", `/api/v1/fees/students/${students[0]!.id}/invoices`);
    if (invoices.invoices.length !== 1) throw new Error(`Expected one Asha invoice, got ${invoices.invoices.length}`);
    await api(admin, "post", "/api/v1/fees/payments", { invoiceId: invoices.invoices[0]!.id, amountPaise: 40000, mode: "upi", ref: "DEMO-UPI-001", idempotencyKey: randomUUID() });

    // Dashboard analytics are read from worker-built rollups. Wait until the
    // synthetic register appears there before declaring the demo ready.
    await api(admin, "post", "/api/v1/analytics/recompute", { academicYear });
    let attendanceReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const dashboard = await api<{ tiles: { attendance?: { state: string } }[] }>(admin, "get", `/api/v1/analytics/dashboard?academicYear=${academicYear}`);
      attendanceReady = dashboard.tiles.some((tile) => tile.attendance?.state === "ok");
      if (attendanceReady) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!attendanceReady) throw new Error("Dashboard attendance rollup did not complete within 30 seconds");

    const family = await login(familyCredentials);
    const student = await login(studentCredentials);
    try {
      const cards = await api<{ reportCards: { snapshotId: string }[] }>(family, "get", `/api/v1/school/report-cards/children/${students[0]!.id}`);
      if (cards.reportCards[0]?.snapshotId !== snapshotId) throw new Error("Family cannot read the published card");
      await api(student, "get", "/api/v1/portal/me");
    } finally { await family.dispose(); await student.dispose(); }
    console.log(JSON.stringify({ baseURL, collegeId, classId, sectionId, students: students.length, teacher: teacherCredentials.username, classTeacher: classTeacherCredentials.username, principal: principalCredentials.username, student: studentCredentials.username, family: familyCredentials.username, reportCard: snapshotId, invoices: invoices.invoices.length, timetablePeriods: 12, syllabusUnits: 2, assignments: 1, examPapers: 2 }, null, 2));
  } finally { await admin.dispose(); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
