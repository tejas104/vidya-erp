/// <reference lib="dom" />
import { request, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** Adds repeatable synthetic records to the isolated VDEMO localhost fixture. */
const baseURL = "http://localhost:3125";
const academicYear = "2026-27";
let requestCounter = 0;
type Student = { id: string; fullName: string; admissionNo: string; identityUserId?: string | null };
type Section = { id: string; name: string };
type Class = { id: string; code: string; sections: Section[] };
type Subject = { id: string; code: string };
type Teacher = { id: string; staffNo: string };

function revisionGuidePdf(): string {
  const lines = [
    "Term 2 revision guide - Standard 8",
    "Mathematics: practice fractions and linear equations.",
    "Science: review cells, living systems, and observations.",
    "Bring questions to your subject teacher before assessment week.",
  ];
  const commands = lines.map((line, index) => `BT /F1 ${index === 0 ? 18 : 12} Tf 48 ${770 - index * 30} Td (${line}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii").toString("base64");
}

async function api<T>(client: APIRequestContext, method: "get" | "post" | "put" | "patch", path: string, data?: unknown): Promise<T> {
  requestCounter++;
  const response = await client[method](path, {
    headers: { "x-forwarded-for": `10.79.${Math.floor(requestCounter / 250)}.${requestCounter % 250 + 1}` },
    ...(data === undefined ? {} : { data }),
  });
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`);
  return await response.json() as T;
}

async function login(username: string, password: string): Promise<APIRequestContext> {
  const client = await request.newContext({ baseURL });
  await api(client, "post", "/api/v1/identity/auth/login", { username, password });
  return client;
}

async function main() {
  if (process.env.SCHOOL_DEMO_SEED !== "true") throw new Error("Set SCHOOL_DEMO_SEED=true for the isolated local demo");
  const admin = await login("school-demo-admin", "school-demo-admin-pass-2026");
  try {
    const { colleges } = await api<{ colleges: { id: string; code: string }[] }>(admin, "get", "/api/v1/people/colleges");
    if (colleges.length !== 1 || colleges[0]?.code !== "VDEMO") throw new Error("Refusing to enrich a database other than the isolated VDEMO school");
    const collegeId = colleges[0].id;
    const tree = await api<{ departments: { id: string; classes: Class[]; subjects: Subject[] }[] }>(admin, "get", `/api/v1/people/colleges/${collegeId}/tree`);
    if (tree.departments.length !== 1) throw new Error("Expected one school department");
    const departmentId = tree.departments[0]!.id;
    const classes = tree.departments[0]!.classes;
    const standard8 = classes.find((item) => item.code === "STD8");
    const sectionA = standard8?.sections.find((item) => item.name === "A");
    if (!standard8 || !sectionA) throw new Error("Run seed-school-demo.ts first; Standard 8 A is missing");
    const standard9 = classes.find((item) => item.code === "STD9") ??
      await api<Class>(admin, "post", "/api/v1/people/classes", { departmentId, name: "Standard 9", code: "STD9" });
    const section8B = standard8.sections.find((item) => item.name === "B") ??
      await api<Section>(admin, "post", "/api/v1/people/sections", { classId: standard8.id, name: "B" });
    const section9A = standard9.sections?.find((item) => item.name === "A") ??
      await api<Section>(admin, "post", "/api/v1/people/sections", { classId: standard9.id, name: "A" });
    const sectionData = [
      { code: "8A", sectionId: sectionA.id, names: ["Ishaan Verma", "Diya Nair", "Vihaan Kapoor", "Tara Bose", "Aditya Rao", "Sara Ali", "Arjun Pillai", "Zoya Ahmed", "Neel Banerjee", "Anika Shah", "Rohan Gupta", "Pooja Menon", "Dev Malhotra", "Sana Qureshi", "Yash Kulkarni"] },
      { code: "8B", sectionId: section8B.id, names: ["Nitya Joshi", "Rehan Khan", "Maya Sethi", "Om Prakash", "Ira Chatterjee", "Atharv Jain", "Naina Bhat", "Rudra Singh", "Avni Desai", "Parth Mukherjee"] },
      { code: "9A", sectionId: section9A.id, names: ["Aditi Kulkarni", "Ayaan Siddiqui", "Navya Krishnan", "Karan Sood", "Sia Reddy", "Harsh Patel", "Myra Thomas", "Aryan Ghosh", "Inaya Mir", "Vedant Sharma"] },
    ] as const;
    const rosters = new Map<string, Student[]>();
    for (const group of sectionData) {
      const current = await api<{ students: Student[] }>(admin, "get", `/api/v1/people/sections/${group.sectionId}/roster`);
      const byNumber = new Map(current.students.map((student) => [student.admissionNo, student]));
      for (const [index, name] of group.names.entries()) {
        const admissionNo = `VDEMO-${group.code}-${String(index + (group.code === "8A" ? 6 : 1)).padStart(3, "0")}`;
        if (byNumber.has(admissionNo)) continue;
        const student = await api<Student>(admin, "post", "/api/v1/people/students", { collegeId, admissionNo, fullName: name });
        await api(admin, "post", `/api/v1/people/students/${student.id}/enrollment`, { sectionId: group.sectionId, academicYear });
        await api(admin, "patch", `/api/v1/people/students/${student.id}`, {
          guardianName: ["Kavita", "Rajesh", "Priya", "Sanjay"][index % 4] + " " + name.split(" ").at(-1),
          guardianPhone: `90000${String(index + (group.code === "8A" ? 100 : group.code === "8B" ? 200 : 300)).padStart(5, "0")}`,
          dob: `20${group.code === "9A" ? "11" : "12"}-${String(index % 12 + 1).padStart(2, "0")}-15`,
        });
      }
      const roster = await api<{ students: Student[] }>(admin, "get", `/api/v1/people/sections/${group.sectionId}/roster`);
      rosters.set(group.code, roster.students);
    }
    const class9Pupil = rosters.get("9A")![0]!;
    const { users } = await api<{ users: { id: string; username: string; status: string }[] }>(admin, "get", `/api/v1/identity/users?collegeId=${collegeId}&limit=200`);
    let class9User = users.find((item) => item.username === "school-demo-student-9a");
    if (!class9User) {
      class9User = await api<{ id: string; username: string; status: string }>(admin, "post", "/api/v1/identity/users", {
        collegeId, username: "school-demo-student-9a", displayName: class9Pupil.fullName,
        temporaryPassword: "school-demo-student-9a-pass-2026", roles: ["student"],
      });
      await api(admin, "post", `/api/v1/identity/users/${class9User.id}/password`, { newPassword: "school-demo-student-9a-pass-2026" });
    } else if (class9User.status === "must_reset") {
      await api(admin, "post", `/api/v1/identity/users/${class9User.id}/password`, { newPassword: "school-demo-student-9a-pass-2026" });
    }
    if (class9Pupil.identityUserId !== class9User.id)
      await api(admin, "post", `/api/v1/people/students/${class9Pupil.id}/identity-link`, { identityUserId: class9User.id });

    const subjects = tree.departments[0]!.subjects;
    const maths = subjects.find((subject) => subject.code === "MATH8");
    const science = subjects.find((subject) => subject.code === "SCI8");
    if (!maths || !science) throw new Error("Expected the original two Standard 8 subjects");
    const maths9 = subjects.find((subject) => subject.code === "MATH9") ??
      await api<Subject>(admin, "post", "/api/v1/people/subjects", { departmentId, name: "Mathematics 9", code: "MATH9" });
    const science9 = subjects.find((subject) => subject.code === "SCI9") ??
      await api<Subject>(admin, "post", "/api/v1/people/subjects", { departmentId, name: "Science 9", code: "SCI9" });
    const { teachers } = await api<{ teachers: Teacher[] }>(admin, "get", `/api/v1/people/teachers?collegeId=${collegeId}&limit=50`);
    const ananya = teachers.find((item) => item.staffNo === "VDEMO-T-001");
    const farah = teachers.find((item) => item.staffNo === "VDEMO-T-002");
    if (!ananya || !farah) throw new Error("Expected the original subject and class teachers");
    const class9Assignments = await api<{ assignments: { teacherId: string; subjectId: string | null; kind: string }[] }>(admin, "get", `/api/v1/people/classes/${standard9.id}/assignments`);
    for (const subject of [maths9, science9]) {
      if (!class9Assignments.assignments.some((item) => item.teacherId === farah.id && item.kind === "subject_teacher" && item.subjectId === subject.id))
        await api(admin, "post", `/api/v1/people/teachers/${farah.id}/assignments`, { classId: standard9.id, subjectId: subject.id, academicYear, kind: "subject_teacher" });
    }
    const template = await api<{ periods: { periodNo: number; starts: string; ends: string }[] }>(admin, "get", `/api/v1/timetable/colleges/${collegeId}/periods`);
    if (template.periods.length < 4) await api(admin, "put", `/api/v1/timetable/colleges/${collegeId}/periods`, {
      periods: [...template.periods, { periodNo: 4, starts: "11:35", ends: "12:20" }],
    });
    for (const group of [
      { sectionId: section8B.id, teacherId: ananya.id, subjects: [maths, science], periods: [3, 4], room: "8B" },
      { sectionId: section9A.id, teacherId: farah.id, subjects: [maths9, science9], periods: [1, 2], room: "9A" },
    ]) {
      const grid = await api<{ entries: { dayOfWeek: number; periodNo: number }[] }>(admin, "get", `/api/v1/timetable/sections/${group.sectionId}/grid?academicYear=${academicYear}`);
      for (let dayOfWeek = 1; dayOfWeek <= 6; dayOfWeek++) {
        for (const [index, subject] of group.subjects.entries()) {
          const periodNo = group.periods[index]!;
          if (!grid.entries.some((item) => item.dayOfWeek === dayOfWeek && item.periodNo === periodNo))
            await api(admin, "post", "/api/v1/timetable/entries", { sectionId: group.sectionId, subjectId: subject.id, teacherId: group.teacherId, room: group.room, dayOfWeek, periodNo, academicYear });
        }
      }
    }
    const teacher = await login("school-demo-teacher", "school-demo-teacher-pass-2026");
    const classTeacher = await login("school-demo-class-teacher", "school-demo-class-pass-2026");
    try {
      const terms = await api<{ terms: { id: string; name: string }[] }>(admin, "get", `/api/v1/school/terms?academicYear=${academicYear}`);
      const term2 = terms.terms.find((item) => item.name === "Term 2");
      if (!term2) throw new Error("Expected the original open Term 2");
      let { types } = await api<{ types: { id: string; name: string }[] }>(admin, "get", `/api/v1/school/terms/${term2.id}/assessment-types`);
      if (types.length === 0) {
        const configured = await api<{ types: { id: string; name: string }[] }>(admin, "put", `/api/v1/school/terms/${term2.id}/assessment-types`, {
          types: [{ name: "Class quiz", weight: 40 }, { name: "Unit assessment", weight: 60 }],
        });
        types = configured.types;
      }
      const scaleList = await api<{ scales: { id: string; name: string }[] }>(admin, "get", `/api/v1/results/scales?collegeId=${collegeId}`);
      const scaleId = scaleList.scales.find((item) => item.name === "School A-E")?.id;
      if (!scaleId) throw new Error("Expected the original school grade scale");
      for (const group of [
        { classId: standard8.id, subjects: [maths, science], pupils: [...rosters.get("8A")!, ...rosters.get("8B")!], client: teacher },
        { classId: standard9.id, subjects: [maths9, science9], pupils: rosters.get("9A")!, client: classTeacher },
      ]) {
        const existing = await api<{ assessments: { id: string; termId: string; subjectId: string; typeId: string; name: string }[] }>(group.client, "get", `/api/v1/school/classes/${group.classId}/assessments?academicYear=${academicYear}`);
        for (const subject of group.subjects) for (const [typeIndex, type] of types.entries()) {
          const name = `${subject.code} ${type.name}`;
          const maxScore = typeIndex === 0 ? 20 : 50;
          const assessment = existing.assessments.find((item) => item.termId === term2.id && item.subjectId === subject.id && item.typeId === type.id && item.name === name) ??
            await api<{ id: string }>(group.client, "post", "/api/v1/school/assessments", {
              classId: group.classId, subjectId: subject.id, termId: term2.id, typeId: type.id, scaleId,
              name, maxScore, heldOn: typeIndex === 0 ? "2026-09-15" : "2026-09-22",
            });
          const recorded = await api<{ marks: { studentId: string }[] }>(group.client, "get", `/api/v1/school/assessments/${assessment.id}/marks`);
          const seen = new Set(recorded.marks.map((mark) => mark.studentId));
          const missing = group.pupils.filter((pupil) => !seen.has(pupil.id));
          if (missing.length > 0) await api(group.client, "put", `/api/v1/school/assessments/${assessment.id}/marks`, {
            entries: missing.map((pupil) => {
              const index = group.pupils.findIndex((item) => item.id === pupil.id);
              return { studentId: pupil.id, score: typeIndex === 0 ? 11 + index % 9 : 29 + index % 18 };
            }),
          });
        }
      }
      const syllabus9 = await api<{ units: { subjectId: string; title: string }[] }>(classTeacher, "get", `/api/v1/syllabus/classes/${standard9.id}/syllabus?academicYear=${academicYear}`);
      for (const item of [
        { subject: maths9, title: "Algebra and number systems", topic: "Rational numbers" },
        { subject: science9, title: "Matter and living systems", topic: "Cell structure" },
      ]) {
        if (syllabus9.units.some((unit) => unit.subjectId === item.subject.id && unit.title === item.title)) continue;
        const { id: unitId } = await api<{ id: string }>(classTeacher, "post", "/api/v1/syllabus/units", { classId: standard9.id, subjectId: item.subject.id, academicYear, title: item.title, position: 1 });
        const { id: topicId } = await api<{ id: string }>(classTeacher, "post", `/api/v1/syllabus/units/${unitId}/topics`, { title: item.topic, position: 1 });
        await api(classTeacher, "put", `/api/v1/syllabus/topics/${topicId}/coverage`, { taughtOn: "2026-09-18" });
        await api(classTeacher, "post", `/api/v1/syllabus/units/${unitId}/topics`, { title: "Next lesson", position: 2 });
      }
      const assignments9 = await api<{ assignments: { title: string }[] }>(classTeacher, "get", `/api/v1/coursework/classes/${standard9.id}/assignments?academicYear=${academicYear}`);
      if (!assignments9.assignments.some((item) => item.title === "Explore cells around us"))
        await api(classTeacher, "post", "/api/v1/coursework/assignments", { classId: standard9.id, subjectId: science9.id, academicYear, title: "Explore cells around us", instructions: "Explain how a plant cell and an animal cell differ. Include a labelled sketch.", dueOn: "2026-10-14", maxScore: 25 });
      const assignments = await api<{ assignments: { title: string }[] }>(teacher, "get", `/api/v1/coursework/classes/${standard8.id}/assignments?academicYear=${academicYear}`);
      for (const item of [
        { title: "Fractions in everyday life", subjectId: maths.id, instructions: "Find three examples of fractions at home and explain them.", dueOn: "2026-10-05", maxScore: 15 },
        { title: "Science observation journal", subjectId: science.id, instructions: "Record the weather for five days and write one pattern you notice.", dueOn: "2026-10-12", maxScore: 20 },
      ]) {
        if (!assignments.assignments.some((existing) => existing.title === item.title))
          await api(teacher, "post", "/api/v1/coursework/assignments", { classId: standard8.id, academicYear, ...item });
      }
      const materials = await api<{ materials: { title: string }[] }>(teacher, "get", `/api/v1/coursework/classes/${standard8.id}/materials?academicYear=${academicYear}`);
      if (!materials.materials.some((item) => item.title === "Revision plan: Term 2"))
        await api(teacher, "post", "/api/v1/coursework/materials", {
          classId: standard8.id, subjectId: maths.id, academicYear, title: "Revision plan: Term 2",
          contentType: "application/pdf", dataBase64: revisionGuidePdf(),
        });
      const mine = await api<{ requests: { reason: string }[] }>(teacher, "get", "/api/v1/leave/mine");
      if (!mine.requests.some((item) => item.reason === "Demo appointment for leave review"))
        await api(teacher, "post", "/api/v1/leave/requests", { fromOn: "2026-10-06", toOn: "2026-10-06", kind: "casual", reason: "Demo appointment for leave review" });

      for (const group of sectionData.slice(0, 2)) {
        const roster = rosters.get(group.code)!;
        const sessions = await api<{ sessions: { heldOn: string; slot: string; subjectId: string }[] }>(classTeacher, "get", `/api/v1/academics/sections/${group.sectionId}/attendance?from=2026-09-21&to=2026-09-23&limit=100`);
        for (const [dayIndex, heldOn] of ["2026-09-21", "2026-09-22", "2026-09-23"].entries()) {
          if (sessions.sessions.some((item) => item.heldOn === heldOn && item.slot === "day" && !item.subjectId)) continue;
          await api(classTeacher, "post", "/api/v1/academics/attendance/sessions", {
            sectionId: group.sectionId, heldOn, slot: "day", academicYear,
            entries: roster.map((student, index) => ({ studentId: student.id, status:
              index === (dayIndex + 4) % roster.length ? "absent" :
              index === (dayIndex + 7) % roster.length ? "late" :
              index === (dayIndex + 10) % roster.length ? "excused" : "present" })),
          });
        }
      }
      const subjectSessions = await api<{ sessions: { heldOn: string; slot: string; subjectId: string }[] }>(teacher, "get", `/api/v1/academics/sections/${sectionA.id}/attendance?from=2026-09-23&to=2026-09-23&limit=100`);
      if (!subjectSessions.sessions.some((item) => item.heldOn === "2026-09-23" && item.slot === "p1" && item.subjectId === maths.id))
        await api(teacher, "post", "/api/v1/academics/attendance/sessions", {
          sectionId: sectionA.id, subjectId: maths.id, heldOn: "2026-09-23", slot: "p1", academicYear,
          entries: rosters.get("8A")!.map((student, index) => ({ studentId: student.id, status: index === 2 ? "late" : index === 6 ? "absent" : "present" })),
        });
      const class9Sessions = await api<{ sessions: { heldOn: string; slot: string; subjectId: string }[] }>(classTeacher, "get", `/api/v1/academics/sections/${section9A.id}/attendance?from=2026-09-23&to=2026-09-23&limit=100`);
      if (!class9Sessions.sessions.some((item) => item.heldOn === "2026-09-23" && item.slot === "p1" && item.subjectId === maths9.id))
        await api(classTeacher, "post", "/api/v1/academics/attendance/sessions", {
          sectionId: section9A.id, subjectId: maths9.id, heldOn: "2026-09-23", slot: "p1", academicYear,
          entries: rosters.get("9A")!.map((student, index) => ({ studentId: student.id, status: index === 1 ? "absent" : index === 4 ? "late" : "present" })),
        });
    } finally { await teacher.dispose(); await classTeacher.dispose(); }

    const { heads } = await api<{ heads: { id: string; name: string }[] }>(admin, "get", `/api/v1/fees/heads?collegeId=${collegeId}`);
    const tuition = heads.find((item) => item.name === "Tuition");
    if (!tuition) throw new Error("Expected the original tuition fee head");
    const class9Structures = await api<{ structures: { headId: string }[] }>(admin, "get", `/api/v1/fees/classes/${standard9.id}/structures?academicYear=${academicYear}`);
    if (!class9Structures.structures.some((item) => item.headId === tuition.id))
      await api(admin, "post", "/api/v1/fees/structures", { classId: standard9.id, headId: tuition.id, academicYear, amountPaise: 150000, dueOn: "2026-10-15", installmentNo: 1 });
    for (const group of [
      { classId: standard8.id, sectionIds: [sectionA.id, section8B.id], count: 30 },
      { classId: standard9.id, sectionIds: [section9A.id], count: 10 },
    ]) {
      const current = await Promise.all(group.sectionIds.map((sectionId) =>
        api<{ invoices: unknown[] }>(admin, "get", `/api/v1/fees/sections/${sectionId}/invoices?academicYear=${academicYear}`)));
      if (current.reduce((total, result) => total + result.invoices.length, 0) >= group.count) continue;
      const { runId } = await api<{ runId: string }>(admin, "post", "/api/v1/fees/generate", { classId: group.classId, academicYear });
      let completed = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const run = await api<{ status: string; error: string | null }>(admin, "get", `/api/v1/fees/generate/${runId}`);
        if (run.status === "failed") throw new Error(`Fee generation failed: ${run.error}`);
        if (run.status === "completed") { completed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!completed) throw new Error("Fee generation did not finish within 30 seconds");
    }
    const paidPupil = rosters.get("8B")![0]!;
    const paidInvoices = await api<{ invoices: { id: string; amountPaise: number; paidPaise: number }[] }>(admin, "get", `/api/v1/fees/students/${paidPupil.id}/invoices`);
    const paidInvoice = paidInvoices.invoices[0];
    if (!paidInvoice) throw new Error("Standard 8 B invoice missing after generation");
    if (paidInvoice.paidPaise === 0) await api(admin, "post", "/api/v1/fees/payments", {
      invoiceId: paidInvoice.id, amountPaise: paidInvoice.amountPaise, mode: "upi", ref: "DEMO-UPI-8B-001", idempotencyKey: randomUUID(),
    });
    const scholarshipPupil = rosters.get("9A")![0]!;
    const scholarshipInvoices = await api<{ invoices: { id: string; amountPaise: number; duesPaise: number }[] }>(admin, "get", `/api/v1/fees/students/${scholarshipPupil.id}/invoices`);
    const scholarshipInvoice = scholarshipInvoices.invoices[0];
    if (!scholarshipInvoice) throw new Error("Standard 9 A invoice missing after generation");
    if (scholarshipInvoice.duesPaise === scholarshipInvoice.amountPaise)
      await api(admin, "post", "/api/v1/fees/adjustments", { invoiceId: scholarshipInvoice.id, kind: "scholarship", amountPaise: 30000, reason: "Synthetic merit award for demo" });

    const examSeries = await api<{ series: { id: string; name: string }[] }>(admin, "get", `/api/v1/exams/series?collegeId=${collegeId}&academicYear=${academicYear}`);
    const term2Series = examSeries.series.find((item) => item.name === "Term 2 assessment week");
    if (!term2Series) throw new Error("Expected the original Term 2 exam series");
    const class9Schedule = await api<{ slots: { subjectId: string }[] }>(admin, "get", `/api/v1/exams/classes/${standard9.id}/schedule?academicYear=${academicYear}`);
    for (const [index, subject] of [maths9, science9].entries()) {
      if (!class9Schedule.slots.some((slot) => slot.subjectId === subject.id))
        await api(admin, "post", "/api/v1/exams/slots", { seriesId: term2Series.id, classId: standard9.id, subjectId: subject.id, onDate: index === 0 ? "2026-11-16" : "2026-11-18", starts: "09:00", ends: "11:00", room: "Hall B" });
    }

    const notices = await api<{ notices: { title: string }[] }>(admin, "get", `/api/v1/notices?collegeId=${collegeId}`);
    for (const item of [
      { title: "Science fair registration", body: "Register your project idea with your class teacher by 9 October.", audience: `class:${standard8.id}`, kind: "event", eventDate: "2026-10-09" },
      { title: "Term 2 family meeting", body: "Families are invited to meet teachers and discuss learning progress.", audience: "college", kind: "event", eventDate: "2026-10-17" },
    ]) {
      if (!notices.notices.some((existing) => existing.title === item.title))
        await api(admin, "post", "/api/v1/notices", { collegeId, ...item });
    }
    await api(admin, "post", "/api/v1/analytics/recompute", { academicYear });
    const sectionInvoiceCounts = Object.fromEntries(await Promise.all(sectionData.map(async (group) => {
      const result = await api<{ invoices: unknown[] }>(admin, "get", `/api/v1/fees/sections/${group.sectionId}/invoices?academicYear=${academicYear}`);
      if (result.invoices.length !== rosters.get(group.code)!.length) throw new Error(`Invoices missing in ${group.code}`);
      return [group.code, result.invoices.length] as const;
    })));
    const timetableCounts = Object.fromEntries(await Promise.all(sectionData.map(async (group) => {
      const grid = await api<{ entries: unknown[] }>(admin, "get", `/api/v1/timetable/sections/${group.sectionId}/grid?academicYear=${academicYear}`);
      if (grid.entries.length !== 12) throw new Error(`Expected twelve sample periods in ${group.code}, got ${grid.entries.length}`);
      return [group.code, grid.entries.length] as const;
    })));
    const verificationTerms = await api<{ terms: { id: string; name: string }[] }>(admin, "get", `/api/v1/school/terms?academicYear=${academicYear}`);
    const verificationTerm2Id = verificationTerms.terms.find((item) => item.name === "Term 2")?.id;
    if (!verificationTerm2Id) throw new Error("Term 2 missing during verification");
    const term2Assessments = Object.fromEntries(await Promise.all([
      ["STD8", standard8.id], ["STD9", standard9.id],
    ].map(async ([code, classId]) => {
      const result = await api<{ assessments: { termId: string }[] }>(admin, "get", `/api/v1/school/classes/${classId}/assessments?academicYear=${academicYear}`);
      const count = result.assessments.filter((item) => item.termId === verificationTerm2Id).length;
      if (count !== 4) throw new Error(`Expected four Term 2 assessments in ${code}, got ${count}`);
      return [code, count] as const;
    })));
    const class9Student = await login("school-demo-student-9a", "school-demo-student-9a-pass-2026");
    try {
      const me = await api<{ student: { id: string } }>(class9Student, "get", "/api/v1/portal/me");
      const timetable = await api<{ entries: unknown[] }>(class9Student, "get", `/api/v1/portal/timetable?academicYear=${academicYear}`);
      const schoolFees = await api<{ invoices: unknown[] }>(class9Student, "get", "/api/v1/fees/my-fees");
      const schoolExams = await api<{ slots: unknown[] }>(class9Student, "get", "/api/v1/exams/my-schedule");
      const schoolSyllabus = await api<{ subjects: unknown[] }>(class9Student, "get", `/api/v1/syllabus/my?academicYear=${academicYear}`);
      const schoolCoursework = await api<{ assignments: unknown[] }>(class9Student, "get", `/api/v1/coursework/my/assignments?academicYear=${academicYear}`);
      if (me.student.id !== class9Pupil.id || timetable.entries.length === 0 || schoolFees.invoices.length !== 1 ||
          schoolExams.slots.length !== 2 || schoolSyllabus.subjects.length !== 2 || schoolCoursework.assignments.length === 0)
        throw new Error("Standard 9 student demo is missing a timetable, fee, exams, syllabus, or coursework");
    } finally { await class9Student.dispose(); }
    console.log(JSON.stringify({ baseURL, school: "VDEMO", sections: Object.fromEntries(sectionData.map((group) => [group.code, rosters.get(group.code)!.length])), invoices: sectionInvoiceCounts, timetableEntries: timetableCounts, term2Assessments, attendanceDates: ["2026-09-21", "2026-09-22", "2026-09-23"], fixture: "synthetic", repeatable: true }, null, 2));
  } finally { await admin.dispose(); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
