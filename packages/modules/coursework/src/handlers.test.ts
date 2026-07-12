import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Principal, RouteContext, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { createCourseworkHandlers } from "./handlers";
import { DuplicateTitleError, type CourseworkRepo } from "./repo";

const logger = pino({ level: "silent" });
const YEAR = "2026-27";

const teacher: Principal = { id: "u_t", kind: "user", displayName: "t", roles: ["teacher"], scopes: [], grants: [], sessionId: "s" };
const student: Principal = { id: "u_s", kind: "user", displayName: "s", roles: ["student"], scopes: [], grants: [], sessionId: "s" };

function ctx(principal: Principal, input: { params?: unknown; query?: unknown; body?: unknown } = {}): RouteContext {
  return { requestId: "r", logger, principal, request: { params: input.params, query: input.query, body: input.body, headers: new Headers() } };
}

const assignmentRow = {
  id: "cwa_1", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "sub_1",
  teacherId: "tch_1", title: "HW", instructions: "", dueOn: "2026-07-20", maxScore: "10.00",
  academicYear: YEAR, createdAt: new Date(),
};

function makeDeps(opts: { granted?: boolean; duplicate?: boolean; evaluated?: boolean; studentLinked?: boolean } = {}) {
  const repo = {
    createAssignment: async (input: Record<string, unknown>) => {
      if (opts.duplicate) throw new DuplicateTitleError();
      return { ...assignmentRow, ...input };
    },
    getAssignment: async () => assignmentRow,
    upsertSubmission: async () =>
      opts.evaluated
        ? null
        : { id: "cws_1", assignmentId: "cwa_1", studentId: "std_1", body: "x", objectKey: null, submittedAt: new Date(), score: null, feedback: null },
    submissionCount: async () => 0,
    submissionsForAssignment: async () => [],
    submissionFor: async () => null,
  } as unknown as CourseworkRepo;

  const directory = {
    classPath: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" }),
    subjectDepartment: async () => "dep_1",
    teacherByIdentityUser: async () => ({ teacherId: "tch_1", collegeId: "col_1", fullName: "T" }),
    studentByIdentityUser: async () =>
      opts.studentLinked === false ? null : { studentId: "std_1", collegeId: "col_1", fullName: "S" },
    studentPosition: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" }),
    namesFor: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `n:${id}`])),
  } as unknown as PeopleDirectory;

  const scopeChecker = { check: () => ({ granted: opts.granted !== false, reason: "test" }) } as unknown as ScopeChecker;
  const storage = { client: {} as never, bucket: "test" };
  return { repo, directory, scopeChecker, storage };
}

const createBody = { classId: "cls_1", subjectId: "sub_1", title: "HW", instructions: "", dueOn: "2026-07-20", maxScore: 10, academicYear: YEAR };

describe("coursework handlers", () => {
  it("denies assignment-create to a teacher without subject scope", async () => {
    const handlers = createCourseworkHandlers(makeDeps({ granted: false }));
    const result = await handlers["coursework.assignment-create"]!(ctx(teacher, { body: createBody }));
    expect(result.status).toBe(403);
  });

  it("maps a duplicate title to 409", async () => {
    const handlers = createCourseworkHandlers(makeDeps({ duplicate: true }));
    const result = await handlers["coursework.assignment-create"]!(ctx(teacher, { body: createBody }));
    expect(result.status).toBe(409);
  });

  it("creates and enriches the subject name on success", async () => {
    const handlers = createCourseworkHandlers(makeDeps());
    const result = await handlers["coursework.assignment-create"]!(ctx(teacher, { body: createBody }));
    expect(result.status).toBe(201);
    expect((result.body as { subjectName: string }).subjectName).toBe("n:sub_1");
  });

  it("locks resubmission after evaluation with 409", async () => {
    const handlers = createCourseworkHandlers(makeDeps({ evaluated: true }));
    const result = await handlers["coursework.submit"]!(ctx(student, { params: { assignmentId: "cwa_1" }, body: { body: "again" } }));
    expect(result.status).toBe(409);
    expect((result.body as { message: string }).message).toContain("resubmission is locked");
  });

  it("404s an unlinked student sign-in on my-assignments", async () => {
    const handlers = createCourseworkHandlers(makeDeps({ studentLinked: false }));
    const result = await handlers["coursework.my-assignments"]!(ctx(student, { query: { academicYear: YEAR } }));
    expect(result.status).toBe(404);
  });

  it("rejects a score above maxScore with 422", async () => {
    const deps = makeDeps();
    (deps.repo as { getSubmission?: unknown }).getSubmission = async () => ({
      id: "cws_1", assignmentId: "cwa_1", studentId: "std_1", body: "x", objectKey: null,
      submittedAt: new Date(), score: null, feedback: null,
    });
    const handlers = createCourseworkHandlers(deps);
    const result = await handlers["coursework.evaluate"]!(ctx(teacher, { params: { submissionId: "cws_1" }, body: { score: 99, feedback: "" } }));
    expect(result.status).toBe(422);
  });
});
