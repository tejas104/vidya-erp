import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "timetable";
export const TABLE_PREFIX = "ttb_";

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'wall time like "09:00"');
const daySchema = z.coerce.number().int().min(1).max(6);
const periodNoSchema = z.coerce.number().int().min(1).max(12);

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };
const TEACHING = {
  public: false as const,
  requirement: { rolesAnyOf: ["teacher" as const, "class_teacher" as const] },
};
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

const periodSchema = z.object({ periodNo: periodNoSchema, starts: timeSchema, ends: timeSchema });

export const entryViewSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  teacherId: z.string(),
  teacherName: z.string(),
  room: z.string(),
  dayOfWeek: z.number(),
  periodNo: z.number(),
});

const yearQuery = z.object({ academicYear: academicYearSchema });

const routes: RouteSpec[] = [
  {
    id: "timetable.periods-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/timetable/colleges/{collegeId}/periods",
    summary: "The college's period template",
    tags: ["timetable"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ collegeId: idSchema }) },
    responses: {
      200: { description: "Periods in order", schema: z.object({ periods: z.array(periodSchema) }) },
    },
  },
  {
    id: "timetable.periods-set",
    module: MODULE_NAME,
    method: "PUT",
    path: "/api/v1/timetable/colleges/{collegeId}/periods",
    summary: "Replace the college's period template (admin)",
    tags: ["timetable"],
    auth: ADMIN_ONLY,
    request: {
      params: z.object({ collegeId: idSchema }),
      body: z.object({ periods: z.array(periodSchema).max(12) }),
    },
    audit: { action: "timetable.periods-set", resourceType: "period-template" },
    responses: {
      200: { description: "Template replaced", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such college", schema: problemSchema },
    },
  },
  {
    id: "timetable.entry-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/timetable/entries",
    summary: "Schedule a period (admin) — clash-checked by the database",
    description:
      "409 names the busy resource (section/teacher/room). 422 when the subject does not belong to the section's department.",
    tags: ["timetable"],
    auth: ADMIN_ONLY,
    request: {
      body: z.object({
        sectionId: idSchema,
        subjectId: idSchema,
        teacherId: idSchema,
        room: z.string().trim().max(32).default(""),
        dayOfWeek: daySchema,
        periodNo: periodNoSchema,
        academicYear: academicYearSchema,
      }),
    },
    audit: { action: "timetable.entry-created", resourceType: "timetable-entry" },
    responses: {
      201: { description: "Scheduled", schema: entryViewSchema },
      404: { description: "No such section/subject/teacher", schema: problemSchema },
      409: { description: "Section, teacher or room already booked in that period", schema: problemSchema },
      422: { description: "Subject not of the section's department", schema: problemSchema },
    },
  },
  {
    id: "timetable.entry-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/timetable/entries/{entryId}",
    summary: "Unschedule a period (admin)",
    tags: ["timetable"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ entryId: idSchema }) },
    audit: { action: "timetable.entry-deleted", resourceType: "timetable-entry" },
    responses: {
      200: { description: "Removed", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such entry", schema: problemSchema },
    },
  },
  {
    id: "timetable.section-grid",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/timetable/sections/{sectionId}/grid",
    summary: "A section's weekly grid (scope-checked read)",
    tags: ["timetable"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ sectionId: idSchema }), query: yearQuery },
    responses: {
      200: {
        description: "Weekly entries + the period template",
        schema: z.object({
          periods: z.array(periodSchema),
          entries: z.array(entryViewSchema),
        }),
      },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such section", schema: problemSchema },
    },
  },
  {
    id: "timetable.my-today",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/timetable/my/today",
    summary: "The signed-in teacher's periods for today (self via the identity link)",
    tags: ["timetable"],
    auth: TEACHING,
    request: { query: yearQuery },
    responses: {
      200: {
        description: "Today's ordered periods (empty on Sundays)",
        schema: z.object({
          dayOfWeek: z.number(),
          periods: z.array(periodSchema),
          entries: z.array(
            entryViewSchema.extend({ sectionName: z.string(), className: z.string() }),
          ),
        }),
      },
      404: { description: "This sign-in is not linked to a teacher record", schema: problemSchema },
    },
  },
];

export const timetableModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
};
