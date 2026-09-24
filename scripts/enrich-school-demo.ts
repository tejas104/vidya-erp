/// <reference lib="dom" />
import { request, type APIRequestContext } from "@playwright/test";

/** Adds repeatable synthetic records to the isolated VDEMO localhost fixture. */
const baseURL = "http://localhost:3125";
const academicYear = "2026-27";
let requestCounter = 0;
type Student = { id: string; fullName: string; admissionNo: string };
type Section = { id: string; name: string };
type Class = { id: string; code: string; sections: Section[] };
type Subject = { id: string; code: string };

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

    const subjects = tree.departments[0]!.subjects;
    const maths = subjects.find((subject) => subject.code === "MATH8");
    const science = subjects.find((subject) => subject.code === "SCI8");
    if (!maths || !science) throw new Error("Expected the original two Standard 8 subjects");
    const teacher = await login("school-demo-teacher", "school-demo-teacher-pass-2026");
    const classTeacher = await login("school-demo-class-teacher", "school-demo-class-pass-2026");
    try {
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
    } finally { await teacher.dispose(); await classTeacher.dispose(); }

    const notices = await api<{ notices: { title: string }[] }>(admin, "get", `/api/v1/notices?collegeId=${collegeId}`);
    for (const item of [
      { title: "Science fair registration", body: "Register your project idea with your class teacher by 9 October.", audience: `class:${standard8.id}`, kind: "event", eventDate: "2026-10-09" },
      { title: "Term 2 family meeting", body: "Families are invited to meet teachers and discuss learning progress.", audience: "college", kind: "event", eventDate: "2026-10-17" },
    ]) {
      if (!notices.notices.some((existing) => existing.title === item.title))
        await api(admin, "post", "/api/v1/notices", { collegeId, ...item });
    }
    await api(admin, "post", "/api/v1/analytics/recompute", { academicYear });
    console.log(JSON.stringify({ baseURL, school: "VDEMO", sections: Object.fromEntries(sectionData.map((group) => [group.code, rosters.get(group.code)!.length])), attendanceDates: ["2026-09-21", "2026-09-22", "2026-09-23"], fixture: "synthetic", repeatable: true }, null, 2));
  } finally { await admin.dispose(); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
