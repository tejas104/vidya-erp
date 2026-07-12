import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Principal, RouteContext, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { createTimetableHandlers } from "./handlers";
import { SlotClashError, type TimetableRepo } from "./read-model";

const logger = pino({ level: "silent" });
const YEAR = "2026-27";

const admin: Principal = { id: "u_a", kind: "user", displayName: "a", roles: ["admin"], scopes: [], grants: [], sessionId: "s" };
const teacher: Principal = { id: "u_t", kind: "user", displayName: "t", roles: ["teacher"], scopes: [], grants: [], sessionId: "s" };

function ctx(principal: Principal, input: { params?: unknown; query?: unknown; body?: unknown } = {}): RouteContext {
  return { requestId: "r", logger, principal, request: { params: input.params, query: input.query, body: input.body, headers: new Headers() } };
}

function makeDeps(opts: { clash?: "teacher" | "section" | "room"; teacherLinked?: boolean } = {}) {
  const repo = {
    periodsFor: async () => [{ id: "p1", collegeId: "col_1", periodNo: 1, starts: "09:00", ends: "09:50", createdAt: new Date() }],
    setPeriods: async () => undefined,
    createEntry: async (entry: Record<string, unknown>) => {
      if (opts.clash) throw new SlotClashError(opts.clash);
      return { id: "tte_1", room: "", createdAt: new Date(), ...entry };
    },
    getEntry: async () => null,
    deleteEntry: async () => true,
    entriesForSection: async () => [],
    entriesForTeacher: async () => [],
    entriesForTeacherDay: async () => [],
  } as unknown as TimetableRepo;

  const directory = {
    collegeExists: async () => true,
    sectionPath: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" }),
    subjectDepartment: async (id: string) => (id === "sub_wrongdept" ? "dep_OTHER" : "dep_1"),
    teacherByIdentityUser: async () =>
      opts.teacherLinked === false ? null : { teacherId: "tch_1", collegeId: "col_1", fullName: "T" },
    namesFor: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `n:${id}`])),
  } as unknown as PeopleDirectory;

  const scopeChecker = { check: () => ({ granted: true, reason: "test" }) } as unknown as ScopeChecker;
  return { repo, directory, scopeChecker };
}

const body = { sectionId: "sec_1", subjectId: "sub_1", teacherId: "tch_1", room: "", dayOfWeek: 1, periodNo: 1, academicYear: YEAR };

describe("timetable handlers", () => {
  it("maps a slot clash to a 409 naming the busy resource", async () => {
    const handlers = createTimetableHandlers(makeDeps({ clash: "teacher" }));
    const result = await handlers["timetable.entry-create"]!(ctx(admin, { body }));
    expect(result.status).toBe(409);
    expect((result.body as { message: string }).message).toContain("teacher is already booked");
  });

  it("rejects a subject from another department with 422", async () => {
    const handlers = createTimetableHandlers(makeDeps());
    const result = await handlers["timetable.entry-create"]!(ctx(admin, { body: { ...body, subjectId: "sub_wrongdept" } }));
    expect(result.status).toBe(422);
  });

  it("creates and enriches names on success", async () => {
    const handlers = createTimetableHandlers(makeDeps());
    const result = await handlers["timetable.entry-create"]!(ctx(admin, { body }));
    expect(result.status).toBe(201);
    expect((result.body as { subjectName: string }).subjectName).toBe("n:sub_1");
  });

  it("my-today 404s an unlinked teacher sign-in", async () => {
    const handlers = createTimetableHandlers(makeDeps({ teacherLinked: false }));
    const result = await handlers["timetable.my-today"]!(ctx(teacher, { query: { academicYear: YEAR } }));
    expect(result.status).toBe(404);
  });
});
