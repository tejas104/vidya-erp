import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "exams";
export const TABLE_PREFIX = "exm_";

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date like "2026-11-02"');
export const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'time like "09:30"');
export const termSchema = z.string().trim().min(1).max(32);

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };
const STUDENT_ONLY = { public: false as const, requirement: { rolesAnyOf: ["student" as const] } };
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

export const seriesViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  name: z.string(),
  academicYear: z.string(),
  term: z.string(),
  slotCount: z.number(),
});

export const slotViewSchema = z.object({
  id: z.string(),
  seriesId: z.string(),
  seriesName: z.string(),
  classId: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  onDate: z.string(),
  starts: z.string(),
  ends: z.string(),
  room: z.string(),
});

const routes: RouteSpec[] = [
  {
    id: "exams.series-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/exams/series",
    summary: "Create an exam series (admin) — e.g. \"Midterm\" 2026-27 Term 1",
    tags: ["exams"],
    auth: ADMIN_ONLY,
    request: {
      body: z.object({
        collegeId: idSchema,
        name: z.string().trim().min(1).max(64),
        academicYear: academicYearSchema,
        term: termSchema,
      }),
    },
    audit: { action: "exams.series-created", resourceType: "exam-series" },
    responses: {
      201: { description: "Created", schema: seriesViewSchema },
      404: { description: "No such college", schema: problemSchema },
      409: { description: "A series with this name already exists for the year", schema: problemSchema },
    },
  },
  {
    id: "exams.series-list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/exams/series",
    summary: "List a college's exam series for a year (admin)",
    tags: ["exams"],
    auth: ADMIN_ONLY,
    request: { query: z.object({ collegeId: idSchema, academicYear: academicYearSchema }) },
    responses: {
      200: { description: "Series", schema: z.object({ series: z.array(seriesViewSchema) }) },
    },
  },
  {
    id: "exams.series-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/exams/series/{seriesId}",
    summary: "Delete an exam series and its slots (admin)",
    tags: ["exams"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ seriesId: idSchema }) },
    audit: { action: "exams.series-deleted", resourceType: "exam-series" },
    responses: {
      200: { description: "Deleted (slots cascade)", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such series", schema: problemSchema },
    },
  },
  {
    id: "exams.slot-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/exams/slots",
    summary: "Schedule a paper (admin) — clash with the weekly timetable WARNS, never blocks",
    description:
      "The response's optional `clash` string names the busy room (e.g. \"Room 12 busy: BSc-1 Physics\") when the slot's date/time lands on a timetabled lesson in the same room. Exams routinely displace lessons, so this is advisory.",
    tags: ["exams"],
    auth: ADMIN_ONLY,
    request: {
      body: z.object({
        seriesId: idSchema,
        classId: idSchema,
        subjectId: idSchema,
        onDate: dateSchema,
        starts: timeSchema,
        ends: timeSchema,
        room: z.string().trim().max(64).default(""),
      }),
    },
    audit: { action: "exams.slot-created", resourceType: "exam-slot" },
    responses: {
      201: { description: "Scheduled", schema: slotViewSchema.extend({ clash: z.string().optional() }) },
      404: { description: "No such series/class/subject", schema: problemSchema },
      409: { description: "This subject already has a slot in this series for the class", schema: problemSchema },
      422: { description: "The paper would end before it starts", schema: problemSchema },
    },
  },
  {
    id: "exams.slot-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/exams/slots/{slotId}",
    summary: "Take a paper off the schedule (admin)",
    tags: ["exams"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ slotId: idSchema }) },
    audit: { action: "exams.slot-deleted", resourceType: "exam-slot" },
    responses: {
      200: { description: "Deleted", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such slot", schema: problemSchema },
    },
  },
  {
    id: "exams.class-schedule",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/exams/classes/{classId}/schedule",
    summary: "A class's exam schedule (staff whose scope covers the class)",
    tags: ["exams"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ classId: idSchema }), query: z.object({ academicYear: academicYearSchema }) },
    responses: {
      200: { description: "Slots, soonest first", schema: z.object({ slots: z.array(slotViewSchema) }) },
      403: { description: "Class outside the caller's scope", schema: problemSchema },
      404: { description: "No such class", schema: problemSchema },
    },
  },
  {
    id: "exams.my-schedule",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/exams/my-schedule",
    summary: "The signed-in student's exam schedule (self via the identity link)",
    tags: ["exams"],
    auth: STUDENT_ONLY,
    responses: {
      200: { description: "The student's slots, soonest first", schema: z.object({ slots: z.array(slotViewSchema) }) },
      404: { description: "This sign-in is not linked to a student record", schema: problemSchema },
    },
  },
];

export const examsModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
};
