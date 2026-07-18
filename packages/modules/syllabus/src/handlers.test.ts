import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Principal, RouteContext, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { createSyllabusHandlers } from "./handlers";
import type { SylTopicRow, SylUnitRow } from "./db/schema";
import type { SyllabusRepo } from "./repo";
import { DuplicateTitleError } from "./repo";

const logger = pino({ level: "silent" });
const YEAR = "2026-27";

function principalWith(roles: Principal["roles"], id = "u_1"): Principal {
  return { id, kind: "user", displayName: null, roles, scopes: [], grants: [], sessionId: "s" };
}
const teacher = principalWith(["teacher"], "u_teacher");
const student = principalWith(["student"], "u_student");

function ctx(principal: Principal, input: { params?: unknown; query?: unknown; body?: unknown } = {}): RouteContext {
  return {
    requestId: "r",
    logger,
    principal,
    request: { params: input.params, query: input.query, body: input.body, headers: new Headers() },
  };
}

/** In-memory SyllabusRepo, per the brief's fake harness. */
function makeFakeRepo() {
  const units = new Map<string, SylUnitRow>();
  const topics = new Map<string, SylTopicRow>();
  const titleIndex = new Set<string>(); // classId|subjectId|academicYear|title

  const repo: SyllabusRepo = {
    async createUnit(input) {
      const key = `${input.classId}|${input.subjectId}|${input.academicYear}|${input.title}`;
      if (titleIndex.has(key)) throw new DuplicateTitleError();
      titleIndex.add(key);
      const row: SylUnitRow = { ...input, createdAt: new Date() };
      units.set(row.id, row);
      return row;
    },
    async getUnit(unitId) {
      return units.get(unitId) ?? null;
    },
    async updateUnit(unitId, patch) {
      const row = units.get(unitId);
      if (row === undefined) return null;
      const updated = { ...row, ...patch };
      units.set(unitId, updated);
      return updated;
    },
    async deleteUnit(unitId) {
      units.delete(unitId);
      for (const [id, topic] of topics) if (topic.unitId === unitId) topics.delete(id);
    },
    async unitsForClass(classId, academicYear) {
      return [...units.values()].filter((u) => u.classId === classId && u.academicYear === academicYear);
    },
    async createTopic(input) {
      const row: SylTopicRow = { ...input, taughtOn: null, taughtBy: null, createdAt: new Date() };
      topics.set(row.id, row);
      return row;
    },
    async getTopic(topicId) {
      return topics.get(topicId) ?? null;
    },
    async updateTopic(topicId, patch) {
      const row = topics.get(topicId);
      if (row === undefined) return null;
      const updated = { ...row, ...patch };
      topics.set(topicId, updated);
      return updated;
    },
    async deleteTopic(topicId) {
      topics.delete(topicId);
    },
    async setCoverage(topicId, taughtOn, taughtBy) {
      const row = topics.get(topicId);
      if (row === undefined) return null;
      const updated = { ...row, taughtOn, taughtBy };
      topics.set(topicId, updated);
      return updated;
    },
    async topicsForUnits(unitIds) {
      return [...topics.values()].filter((t) => unitIds.includes(t.unitId));
    },
  };
  return { repo, units, topics };
}

/** Fake PeopleDirectory: one class (cls_1) in dep_1, one linked student in cls_1. */
function makeFakeDirectory(opts: { studentLinked?: boolean; studentClassId?: string | undefined } = {}) {
  const directory = {
    classPath: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" }),
    subjectDepartment: async () => "dep_1",
    teacherByIdentityUser: async () => ({ teacherId: "tch_1", collegeId: "col_1", fullName: "T" }),
    studentByIdentityUser: async () =>
      opts.studentLinked === false ? null : { studentId: "std_1", collegeId: "col_1", fullName: "S", admissionNo: "A1", status: "active" },
    studentPosition: async () =>
      opts.studentClassId === undefined
        ? { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" }
        : opts.studentClassId === ""
          ? { collegeId: "col_1" }
          : { collegeId: "col_1", departmentId: "dep_1", classId: opts.studentClassId },
    namesFor: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `n:${id}`])),
  } as unknown as PeopleDirectory;
  return directory;
}

/** Grants only for subjectId === "S1" (the brief's scope-checker fake). */
function makeFakeScopeChecker(): ScopeChecker {
  return { check: (_p, _a, resource) => ({ granted: resource.subjectId === "S1", reason: "test" }) };
}

describe("syllabus handlers", () => {
  it("lets the S1 teacher create a unit and add a topic (201)", async () => {
    const { repo } = makeFakeRepo();
    const handlers = createSyllabusHandlers({ repo, directory: makeFakeDirectory(), scopeChecker: makeFakeScopeChecker() });
    const created = await handlers["syllabus.unit-create"]!(
      ctx(teacher, { body: { classId: "cls_1", subjectId: "S1", academicYear: YEAR, title: "Unit 1", position: 0 } }),
    );
    expect(created.status).toBe(201);
    const unitId = (created.body as { id: string }).id;

    const topic = await handlers["syllabus.topic-create"]!(
      ctx(teacher, { params: { unitId }, body: { title: "Topic A", position: 0 } }),
    );
    expect(topic.status).toBe(201);
  });

  it("denies unit-create for a teacher without S2 scope (403)", async () => {
    const { repo } = makeFakeRepo();
    const handlers = createSyllabusHandlers({ repo, directory: makeFakeDirectory(), scopeChecker: makeFakeScopeChecker() });
    const result = await handlers["syllabus.unit-create"]!(
      ctx(teacher, { body: { classId: "cls_1", subjectId: "S2", academicYear: YEAR, title: "Unit 1", position: 0 } }),
    );
    expect(result.status).toBe(403);
  });

  it("topic-coverage sets taughtOn + taughtBy, and clearing nulls both", async () => {
    const { repo, units, topics } = makeFakeRepo();
    const unit: SylUnitRow = {
      id: "u1", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "S1",
      teacherId: "tch_1", academicYear: YEAR, title: "Unit 1", position: 0, createdAt: new Date(),
    };
    units.set(unit.id, unit);
    const topic: SylTopicRow = { id: "t1", unitId: unit.id, title: "Topic A", position: 0, taughtOn: null, taughtBy: null, createdAt: new Date() };
    topics.set(topic.id, topic);
    const handlers = createSyllabusHandlers({ repo, directory: makeFakeDirectory(), scopeChecker: makeFakeScopeChecker() });

    const set = await handlers["syllabus.topic-coverage"]!(ctx(teacher, { params: { topicId: "t1" }, body: { taughtOn: "2026-07-18" } }));
    expect(set.status).toBe(200);
    expect(topics.get("t1")).toMatchObject({ taughtOn: "2026-07-18", taughtBy: "u_teacher" });

    const cleared = await handlers["syllabus.topic-coverage"]!(ctx(teacher, { params: { topicId: "t1" }, body: { taughtOn: null } }));
    expect(cleared.status).toBe(200);
    expect(topics.get("t1")).toMatchObject({ taughtOn: null, taughtBy: null });
  });

  it("class-syllabus row-filters by subject scope and computes coveragePct", async () => {
    const { repo, units, topics } = makeFakeRepo();
    const unitS1: SylUnitRow = {
      id: "u_s1", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "S1",
      teacherId: "tch_1", academicYear: YEAR, title: "S1 Unit", position: 0, createdAt: new Date(),
    };
    const unitS2: SylUnitRow = {
      id: "u_s2", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "S2",
      teacherId: "tch_1", academicYear: YEAR, title: "S2 Unit", position: 1, createdAt: new Date(),
    };
    units.set(unitS1.id, unitS1);
    units.set(unitS2.id, unitS2);
    // S1 unit: 1 of 2 topics taught -> 50%.
    topics.set("t1", { id: "t1", unitId: "u_s1", title: "A", position: 0, taughtOn: "2026-07-01", taughtBy: "tch_1", createdAt: new Date() });
    topics.set("t2", { id: "t2", unitId: "u_s1", title: "B", position: 1, taughtOn: null, taughtBy: null, createdAt: new Date() });
    // S2 unit: not visible to this teacher.
    topics.set("t3", { id: "t3", unitId: "u_s2", title: "C", position: 0, taughtOn: "2026-07-01", taughtBy: "tch_1", createdAt: new Date() });

    const handlers = createSyllabusHandlers({ repo, directory: makeFakeDirectory(), scopeChecker: makeFakeScopeChecker() });
    const result = await handlers["syllabus.class-syllabus"]!(ctx(teacher, { params: { classId: "cls_1" }, query: { academicYear: YEAR } }));
    expect(result.status).toBe(200);
    const body = result.body as { units: { subjectId: string; coveragePct: number }[] };
    expect(body.units.map((u) => u.subjectId)).toEqual(["S1"]);
    expect(body.units[0]!.coveragePct).toBe(50);
  });

  it("my resolves a linked student's class and groups by subject with coverage", async () => {
    const { repo, units, topics } = makeFakeRepo();
    const unit: SylUnitRow = {
      id: "u1", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "S1",
      teacherId: "tch_1", academicYear: YEAR, title: "Unit 1", position: 0, createdAt: new Date(),
    };
    units.set(unit.id, unit);
    topics.set("t1", { id: "t1", unitId: "u1", title: "A", position: 0, taughtOn: "2026-07-01", taughtBy: "tch_1", createdAt: new Date() });
    topics.set("t2", { id: "t2", unitId: "u1", title: "B", position: 1, taughtOn: "2026-07-02", taughtBy: "tch_1", createdAt: new Date() });

    const handlers = createSyllabusHandlers({ repo, directory: makeFakeDirectory(), scopeChecker: makeFakeScopeChecker() });
    const result = await handlers["syllabus.my"]!(ctx(student, { query: { academicYear: YEAR } }));
    expect(result.status).toBe(200);
    const body = result.body as { subjects: { subjectId: string; coveragePct: number }[] };
    expect(body.subjects).toHaveLength(1);
    expect(body.subjects[0]!.subjectId).toBe("S1");
    expect(body.subjects[0]!.coveragePct).toBe(100);
  });

  it("404s an unlinked student sign-in on my", async () => {
    const { repo } = makeFakeRepo();
    const handlers = createSyllabusHandlers({
      repo,
      directory: makeFakeDirectory({ studentLinked: false }),
      scopeChecker: makeFakeScopeChecker(),
    });
    const result = await handlers["syllabus.my"]!(ctx(student, { query: { academicYear: YEAR } }));
    expect(result.status).toBe(404);
  });

  it("returns empty subjects for a linked-but-unenrolled student", async () => {
    const { repo } = makeFakeRepo();
    const handlers = createSyllabusHandlers({
      repo,
      directory: makeFakeDirectory({ studentClassId: "" }),
      scopeChecker: makeFakeScopeChecker(),
    });
    const result = await handlers["syllabus.my"]!(ctx(student, { query: { academicYear: YEAR } }));
    expect(result.status).toBe(200);
    expect((result.body as { subjects: unknown[] }).subjects).toEqual([]);
  });

  it("maps a duplicate unit title to 409", async () => {
    const { repo } = makeFakeRepo();
    const handlers = createSyllabusHandlers({ repo, directory: makeFakeDirectory(), scopeChecker: makeFakeScopeChecker() });
    const body = { classId: "cls_1", subjectId: "S1", academicYear: YEAR, title: "Dup", position: 0 };
    const first = await handlers["syllabus.unit-create"]!(ctx(teacher, { body }));
    expect(first.status).toBe(201);
    const second = await handlers["syllabus.unit-create"]!(ctx(teacher, { body }));
    expect(second.status).toBe(409);
  });
});
