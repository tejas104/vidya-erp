import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Principal, RouteContext } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { AcademicsReadModel, MarkRecordView } from "@vidya/module-academics";
import { createResultsHandlers } from "./handlers";
import type { ResultsRepo } from "./repo";
import { AlreadyPublishedError, DuplicateScaleError, ScaleInUseError } from "./repo";
import type { Band } from "./gpa";
import type { GradeScaleRow, PublicationRow, SubjectCreditRow } from "./db/schema";

const logger = pino({ level: "silent" });
const YEAR = "2026-27";

/** The plan's golden scale. */
const BANDS: Band[] = [
  { minPct: 90, grade: "A+", points: 10 },
  { minPct: 80, grade: "A", points: 9 },
  { minPct: 70, grade: "B+", points: 8 },
  { minPct: 60, grade: "B", points: 7 },
  { minPct: 50, grade: "C", points: 6 },
  { minPct: 40, grade: "D", points: 5 },
  { minPct: 0, grade: "F", points: 0 },
];

function principal(roles: Principal["roles"], grants: Principal["grants"], id = "u_1"): Principal {
  return { id, kind: "user", displayName: "x", roles, scopes: [], grants, sessionId: "s" };
}
const admin = principal(["admin"], [{ role: "admin", org: { collegeId: "col_1" } }]);
const outsider = principal(["admin"], [{ role: "admin", org: { collegeId: "col_other" } }]);
const alphaStudent = principal(["student"], [], "u_alpha");

function ctx(p: Principal, input: { params?: unknown; query?: unknown; body?: unknown } = {}): RouteContext {
  return { requestId: "r", logger, principal: p, request: { params: input.params, query: input.query, body: input.body, headers: new Headers() } };
}

function mark(studentId: string, subjectId: string, scorePct: number): MarkRecordView {
  return {
    markId: `m_${studentId}_${subjectId}_${scorePct}`,
    studentId,
    scorePct,
    kind: "exam",
    assessmentName: "x",
    heldOn: null,
    recordedAt: "2026-07-01T00:00:00Z",
    academicYear: YEAR,
    position: { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId },
  };
}

/** Golden fixture: Alpha ⇒ SGPA 8.30, Beta ⇒ 3.90 (plan R1). */
const MARKS: MarkRecordView[] = [
  mark("stu_a", "sub_ds", 80), mark("stu_a", "sub_ds", 75), mark("stu_a", "sub_ds", 80.5),
  mark("stu_a", "sub_mth", 62),
  mark("stu_a", "sub_dbms", 91),
  mark("stu_b", "sub_ds", 34),
  mark("stu_b", "sub_mth", 50),
  mark("stu_b", "sub_dbms", 69.95),
];

function makeDeps() {
  const scales = new Map<string, GradeScaleRow>([
    ["scl_1", { id: "scl_1", collegeId: "col_1", name: "10-point", bands: BANDS, createdAt: new Date() }],
  ]);
  const publications: PublicationRow[] = [];
  const credits: SubjectCreditRow[] = [
    { id: "c1", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "sub_ds", academicYear: YEAR, credits: 4 },
    { id: "c2", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "sub_mth", academicYear: YEAR, credits: 3 },
    { id: "c3", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "sub_dbms", academicYear: YEAR, credits: 3 },
  ];

  const repo: ResultsRepo = {
    async createScale(collegeId, name, bands) {
      if ([...scales.values()].some((s) => s.collegeId === collegeId && s.name === name)) throw new DuplicateScaleError();
      const row: GradeScaleRow = { id: `scl_${scales.size + 1}`, collegeId, name, bands, createdAt: new Date() };
      scales.set(row.id, row);
      return row;
    },
    async getScale(scaleId) {
      return scales.get(scaleId) ?? null;
    },
    async listScales(collegeId) {
      return [...scales.values()].filter((s) => s.collegeId === collegeId);
    },
    async updateScale(scaleId, patch) {
      if (publications.some((p) => p.scaleId === scaleId)) throw new ScaleInUseError();
      const row = scales.get(scaleId);
      if (row === undefined) return null;
      const next = { ...row, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.bands !== undefined ? { bands: patch.bands } : {}) };
      scales.set(scaleId, next);
      return next;
    },
    async deleteScale(scaleId) {
      if (publications.some((p) => p.scaleId === scaleId)) throw new ScaleInUseError();
      return scales.delete(scaleId);
    },
    async scaleInUse(scaleId) {
      return publications.some((p) => p.scaleId === scaleId);
    },
    async creditsFor(classId, academicYear) {
      return credits.filter((c) => c.classId === classId && c.academicYear === academicYear);
    },
    async replaceCredits(position, academicYear, entries) {
      return entries.map((entry, index) => ({
        id: `c_new_${index}`,
        collegeId: position.collegeId,
        departmentId: position.departmentId,
        classId: position.classId,
        subjectId: entry.subjectId,
        academicYear,
        credits: entry.credits,
      }));
    },
    async publish(input) {
      if (publications.some((p) => p.classId === input.classId && p.academicYear === input.academicYear && p.term === input.term)) {
        throw new AlreadyPublishedError();
      }
      const row: PublicationRow = {
        id: `pub_${publications.length + 1}`,
        collegeId: input.collegeId,
        departmentId: input.departmentId,
        classId: input.classId,
        academicYear: input.academicYear,
        term: input.term,
        scaleId: input.scaleId,
        publishedAt: new Date("2026-07-13T12:00:00Z"),
        publishedBy: input.publishedBy,
      };
      publications.push(row);
      return row;
    },
    async publicationsForClass(classId, academicYear) {
      return publications.filter((p) => p.classId === classId && (academicYear === undefined || p.academicYear === academicYear));
    },
  };

  const directory = {
    collegeExists: async (id: string) => id === "col_1",
    classPath: async (id: string) => (id === "cls_1" ? { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" } : null),
    subjectDepartment: async (id: string) => (id.startsWith("sub_") ? "dep_1" : null),
    sectionsOfClass: async () => [{ sectionId: "sec_1", name: "A" }],
    sectionRoster: async () => [
      { studentId: "stu_a", academicYear: YEAR },
      { studentId: "stu_b", academicYear: YEAR },
      { studentId: "stu_c", academicYear: YEAR }, // no marks — must be omitted, not zeroed
    ],
    studentsBrief: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, { fullName: `name:${id}`, admissionNo: `adm:${id}` }])),
    namesFor: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `n:${id}`])),
    studentByIdentityUser: async (userId: string) =>
      userId === "u_alpha" ? { studentId: "stu_a", collegeId: "col_1", fullName: "Alpha", admissionNo: "A-1", status: "active" } : null,
    studentPosition: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" }),
  } as unknown as PeopleDirectory;

  const marks = {
    studentMarks: async (studentId: string) => MARKS.filter((m) => m.studentId === studentId),
  } as unknown as AcademicsReadModel;

  return { repo, directory, marks };
}

describe("results.class-results (compile preview)", () => {
  it("computes the golden numbers and ranks — Alpha 8.30 #1, Beta 3.90 #2, markless student omitted", async () => {
    const handlers = createResultsHandlers(makeDeps());
    const result = await handlers["results.class-results"]!(
      ctx(admin, { params: { classId: "cls_1" }, query: { academicYear: YEAR, scaleId: "scl_1" } }),
    );
    expect(result.status).toBe(200);
    const rows = (result.body as { rows: { studentId: string; sgpa: number; rank: number; subjects: { grade: string }[] }[] }).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ studentId: "stu_a", sgpa: 8.3, rank: 1 });
    expect(rows[1]).toMatchObject({ studentId: "stu_b", sgpa: 3.9, rank: 2 });
    expect(rows[1]!.subjects.map((s) => s.grade).sort()).toEqual(["B", "C", "F"]);
  });

  it("answers 422 when no credits are set for the year", async () => {
    const handlers = createResultsHandlers(makeDeps());
    const result = await handlers["results.class-results"]!(
      ctx(admin, { params: { classId: "cls_1" }, query: { academicYear: "2027-28", scaleId: "scl_1" } }),
    );
    expect(result.status).toBe(422);
  });

  it("denies a caller from another college", async () => {
    const handlers = createResultsHandlers(makeDeps());
    const result = await handlers["results.class-results"]!(
      ctx(outsider, { params: { classId: "cls_1" }, query: { academicYear: YEAR, scaleId: "scl_1" } }),
    );
    expect(result.status).toBe(403);
  });
});

describe("results.publish + the publication gate", () => {
  it("student sees nothing before publish, the golden term after", async () => {
    const deps = makeDeps();
    const handlers = createResultsHandlers(deps);

    const before = await handlers["results.my-results"]!(ctx(alphaStudent));
    expect(before.status).toBe(200);
    expect((before.body as { terms: unknown[]; cgpa: null }).terms).toHaveLength(0);
    expect((before.body as { cgpa: null }).cgpa).toBeNull();

    const published = await handlers["results.publish"]!(
      ctx(admin, { body: { classId: "cls_1", academicYear: YEAR, term: "Term 1", scaleId: "scl_1" } }),
    );
    expect(published.status).toBe(201);

    const after = await handlers["results.my-results"]!(ctx(alphaStudent));
    const body = after.body as { terms: { term: string; sgpa: number; subjects: unknown[] }[]; cgpa: number };
    expect(body.terms).toHaveLength(1);
    expect(body.terms[0]).toMatchObject({ term: "Term 1", sgpa: 8.3 });
    expect(body.cgpa).toBe(8.3);
  });

  it("answers 409 on a duplicate term and 404 on an unlinked sign-in", async () => {
    const handlers = createResultsHandlers(makeDeps());
    const body = { classId: "cls_1", academicYear: YEAR, term: "Term 1", scaleId: "scl_1" };
    expect((await handlers["results.publish"]!(ctx(admin, { body }))).status).toBe(201);
    expect((await handlers["results.publish"]!(ctx(admin, { body }))).status).toBe(409);
    expect((await handlers["results.my-results"]!(ctx(principal(["student"], [], "u_stranger")))).status).toBe(404);
  });

  it("freezes a published scale: update and delete answer 409", async () => {
    const handlers = createResultsHandlers(makeDeps());
    await handlers["results.publish"]!(ctx(admin, { body: { classId: "cls_1", academicYear: YEAR, term: "Term 1", scaleId: "scl_1" } }));
    const update = await handlers["results.scale-update"]!(
      ctx(admin, { params: { scaleId: "scl_1" }, body: { name: "renamed" } }),
    );
    expect(update.status).toBe(409);
    const remove = await handlers["results.scale-delete"]!(ctx(admin, { params: { scaleId: "scl_1" } }));
    expect(remove.status).toBe(409);
  });
});

describe("scales + credits", () => {
  it("creates, lists, rejects duplicates", async () => {
    const handlers = createResultsHandlers(makeDeps());
    const created = await handlers["results.scale-create"]!(
      ctx(admin, { body: { collegeId: "col_1", name: "5-point", bands: BANDS } }),
    );
    expect(created.status).toBe(201);
    const duplicate = await handlers["results.scale-create"]!(
      ctx(admin, { body: { collegeId: "col_1", name: "10-point", bands: BANDS } }),
    );
    expect(duplicate.status).toBe(409);
    const list = await handlers["results.scale-list"]!(ctx(admin, { query: { collegeId: "col_1" } }));
    expect((list.body as { scales: unknown[] }).scales).toHaveLength(2);
  });

  it("rejects credits for a subject outside the class's department", async () => {
    const handlers = createResultsHandlers(makeDeps());
    const result = await handlers["results.credits-set"]!(
      ctx(admin, {
        body: { classId: "cls_1", academicYear: YEAR, entries: [{ subjectId: "other_x", credits: 3 }] },
      }),
    );
    expect(result.status).toBe(404);
    const ok = await handlers["results.credits-set"]!(
      ctx(admin, {
        body: { classId: "cls_1", academicYear: YEAR, entries: [{ subjectId: "sub_ds", credits: 4 }] },
      }),
    );
    expect(ok.status).toBe(200);
  });
});
