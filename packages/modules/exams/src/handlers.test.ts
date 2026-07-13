import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Principal, RouteContext } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { TimetableReadModel } from "@vidya/module-timetable";
import { createExamsHandlers, createHallTicketSource, isoWeekday } from "./handlers";
import { DuplicateSeriesError, DuplicateSlotError, type ExamsRepo } from "./repo";
import type { ExamSeriesRow, ExamSlotRow } from "./db/schema";

const logger = pino({ level: "silent" });
const YEAR = "2026-27";

function principal(roles: Principal["roles"], grants: Principal["grants"], id = "u_1"): Principal {
  return { id, kind: "user", displayName: "x", roles, scopes: [], grants, sessionId: "s" };
}
const admin = principal(["admin"], [{ role: "admin", org: { collegeId: "col_1" } }]);
const outsider = principal(["admin"], [{ role: "admin", org: { collegeId: "col_other" } }], "u_out");
const teacher = principal(
  ["teacher"],
  [{ role: "teacher", org: { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" }, subjectId: "sub_1" }],
  "u_teach",
);
const alphaStudent = principal(["student"], [], "u_alpha");

function ctx(p: Principal, input: { params?: unknown; query?: unknown; body?: unknown } = {}): RouteContext {
  return { requestId: "r", logger, principal: p, request: { params: input.params, query: input.query, body: input.body, headers: new Headers() } };
}

function makeDeps() {
  const series: ExamSeriesRow[] = [
    { id: "ser_1", collegeId: "col_1", name: "Midterm", academicYear: YEAR, term: "Term 1", createdAt: new Date() },
  ];
  const slots: ExamSlotRow[] = [];

  const repo: ExamsRepo = {
    async createSeries(input) {
      if (series.some((s) => s.collegeId === input.collegeId && s.name === input.name && s.academicYear === input.academicYear)) {
        throw new DuplicateSeriesError();
      }
      const row: ExamSeriesRow = { id: `ser_${series.length + 1}`, createdAt: new Date(), ...input };
      series.push(row);
      return row;
    },
    async getSeries(seriesId) {
      return series.find((s) => s.id === seriesId) ?? null;
    },
    async listSeries(collegeId, academicYear) {
      return series
        .filter((s) => s.collegeId === collegeId && s.academicYear === academicYear)
        .map((s) => ({ ...s, slotCount: slots.filter((slot) => slot.seriesId === s.id).length }));
    },
    async deleteSeries(seriesId) {
      const index = series.findIndex((s) => s.id === seriesId);
      if (index === -1) return false;
      series.splice(index, 1);
      return true;
    },
    async createSlot(input) {
      if (slots.some((s) => s.seriesId === input.seriesId && s.classId === input.classId && s.subjectId === input.subjectId)) {
        throw new DuplicateSlotError();
      }
      const row: ExamSlotRow = { id: `slt_${slots.length + 1}`, ...input };
      slots.push(row);
      return row;
    },
    async getSlot(slotId) {
      return slots.find((s) => s.id === slotId) ?? null;
    },
    async deleteSlot(slotId) {
      const index = slots.findIndex((s) => s.id === slotId);
      if (index === -1) return false;
      slots.splice(index, 1);
      return true;
    },
    async slotsForClass(classId, academicYear) {
      return slots.filter((s) => s.classId === classId && (academicYear === undefined || s.academicYear === academicYear));
    },
  };

  const directory = {
    collegeExists: async (id: string) => id === "col_1",
    classPath: async (id: string) => (id === "cls_1" ? { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" } : null),
    sectionPath: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" }),
    subjectDepartment: async (id: string) => (id.startsWith("sub_") ? "dep_1" : null),
    namesFor: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `n:${id}`])),
    studentsBrief: async (ids: readonly string[]) =>
      new Map(ids.filter((id) => id === "stu_a").map((id) => [id, { fullName: "Alpha", admissionNo: "A-1" }])),
    studentByIdentityUser: async (userId: string) =>
      userId === "u_alpha" ? { studentId: "stu_a", collegeId: "col_1", fullName: "Alpha", admissionNo: "A-1", status: "active" } : null,
    studentPosition: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" }),
  } as unknown as PeopleDirectory;

  // Monday: room 12 hosts P1 (09:00–09:50). Everything else is free.
  const timetable = {
    periods: async () => [
      { periodNo: 1, starts: "09:00", ends: "09:50" },
      { periodNo: 2, starts: "10:00", ends: "10:50" },
    ],
    roomDay: async (_collegeId: string, room: string, _year: string, dayOfWeek: number) =>
      room === "12" && dayOfWeek === 1
        ? [{ id: "tte_1", sectionId: "sec_1", subjectId: "sub_1", subjectName: "Data Structures", teacherId: "t", teacherName: "T", room: "12", dayOfWeek: 1, periodNo: 1 }]
        : [],
  } as unknown as TimetableReadModel;

  return { repo, directory, timetable };
}

// 2026-11-02 is a Monday.
const MONDAY = "2026-11-02";

describe("isoWeekday", () => {
  it("maps Monday to 1 and Sunday to 7", () => {
    expect(isoWeekday("2026-11-02")).toBe(1);
    expect(isoWeekday("2026-11-08")).toBe(7);
  });
});

describe("exams.slot-create clash advisory", () => {
  it("warns when the paper overlaps a lesson in the same room — and still creates (201)", async () => {
    const handlers = createExamsHandlers(makeDeps());
    const result = await handlers["exams.slot-create"]!(
      ctx(admin, { body: { seriesId: "ser_1", classId: "cls_1", subjectId: "sub_1", onDate: MONDAY, starts: "09:30", ends: "11:00", room: "12" } }),
    );
    expect(result.status).toBe(201);
    expect((result.body as { clash?: string }).clash).toBe("Room 12 busy: n:cls_1 Data Structures");
  });

  it("stays quiet when the time, the room or the day is clear", async () => {
    const handlers = createExamsHandlers(makeDeps());
    const clear = await handlers["exams.slot-create"]!(
      ctx(admin, { body: { seriesId: "ser_1", classId: "cls_1", subjectId: "sub_1", onDate: MONDAY, starts: "10:00", ends: "12:00", room: "14" } }),
    );
    expect(clear.status).toBe(201);
    expect((clear.body as { clash?: string }).clash).toBeUndefined();
    // Same room, but after the lesson ends.
    const later = await handlers["exams.slot-create"]!(
      ctx(admin, { body: { seriesId: "ser_1", classId: "cls_1", subjectId: "sub_2", onDate: MONDAY, starts: "09:50", ends: "11:00", room: "12" } }),
    );
    expect((later.body as { clash?: string }).clash).toBeUndefined();
  });

  it("rejects duplicates (409) and inverted windows (422)", async () => {
    const handlers = createExamsHandlers(makeDeps());
    const body = { seriesId: "ser_1", classId: "cls_1", subjectId: "sub_1", onDate: MONDAY, starts: "10:00", ends: "12:00", room: "" };
    expect((await handlers["exams.slot-create"]!(ctx(admin, { body }))).status).toBe(201);
    expect((await handlers["exams.slot-create"]!(ctx(admin, { body }))).status).toBe(409);
    expect(
      (await handlers["exams.slot-create"]!(ctx(admin, { body: { ...body, subjectId: "sub_2", starts: "12:00", ends: "10:00" } }))).status,
    ).toBe(422);
  });
});

describe("schedules + scope", () => {
  it("staff in scope read the class schedule; outsiders are denied", async () => {
    const deps = makeDeps();
    const handlers = createExamsHandlers(deps);
    await handlers["exams.slot-create"]!(
      ctx(admin, { body: { seriesId: "ser_1", classId: "cls_1", subjectId: "sub_1", onDate: MONDAY, starts: "10:00", ends: "12:00", room: "" } }),
    );
    const staff = await handlers["exams.class-schedule"]!(
      ctx(teacher, { params: { classId: "cls_1" }, query: { academicYear: YEAR } }),
    );
    expect(staff.status).toBe(200);
    expect((staff.body as { slots: unknown[] }).slots).toHaveLength(1);
    const denied = await handlers["exams.class-schedule"]!(
      ctx(outsider, { params: { classId: "cls_1" }, query: { academicYear: YEAR } }),
    );
    expect(denied.status).toBe(403);
  });

  it("my-schedule follows the identity link; unlinked sign-ins get 404", async () => {
    const deps = makeDeps();
    const handlers = createExamsHandlers(deps);
    await handlers["exams.slot-create"]!(
      ctx(admin, { body: { seriesId: "ser_1", classId: "cls_1", subjectId: "sub_1", onDate: MONDAY, starts: "10:00", ends: "12:00", room: "7" } }),
    );
    const mine = await handlers["exams.my-schedule"]!(ctx(alphaStudent));
    expect(mine.status).toBe(200);
    expect((mine.body as { slots: { room: string }[] }).slots[0]!.room).toBe("7");
    expect((await handlers["exams.my-schedule"]!(ctx(principal(["student"], [], "u_stranger")))).status).toBe(404);
  });

  it("duplicate series names answer 409; series delete works", async () => {
    const handlers = createExamsHandlers(makeDeps());
    const dup = await handlers["exams.series-create"]!(
      ctx(admin, { body: { collegeId: "col_1", name: "Midterm", academicYear: YEAR, term: "Term 1" } }),
    );
    expect(dup.status).toBe(409);
    expect((await handlers["exams.series-delete"]!(ctx(admin, { params: { seriesId: "ser_1" } }))).status).toBe(200);
  });
});

describe("hall-ticket source", () => {
  it("self and in-scope staff get the ticket; strangers are denied; unknown students 404", async () => {
    const deps = makeDeps();
    const handlers = createExamsHandlers(deps);
    await handlers["exams.slot-create"]!(
      ctx(admin, { body: { seriesId: "ser_1", classId: "cls_1", subjectId: "sub_1", onDate: MONDAY, starts: "10:00", ends: "12:00", room: "7" } }),
    );
    const source = createHallTicketSource(deps);
    const self = await source(alphaStudent, "stu_a");
    expect(self.access).toBe("ok");
    if (self.access === "ok") {
      expect(self.data.slots).toHaveLength(1);
      expect(self.data.slots[0]).toMatchObject({ onDate: MONDAY, room: "7", seriesName: "Midterm" });
    }
    expect((await source(teacher, "stu_a")).access).toBe("ok");
    expect((await source(outsider, "stu_a")).access).toBe("forbidden");
    expect((await source(alphaStudent, "stu_missing")).access).toBe("not-found");
  });
});
