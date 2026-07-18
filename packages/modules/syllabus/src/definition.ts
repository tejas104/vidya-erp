import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "syllabus";
export const TABLE_PREFIX = "syl_";

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const problemSchema = z.object({ type: z.string(), title: z.string(), status: z.number(), requestId: z.string() });

const TEACHER_ONLY = { public: false as const, requirement: { rolesAnyOf: ["teacher" as const, "class_teacher" as const] } };
const STUDENT_ONLY = { public: false as const, requirement: { rolesAnyOf: ["student" as const] } };
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

const topicViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  position: z.number(),
  taughtOn: z.string().nullable(),
});
export const unitViewSchema = z.object({
  id: z.string(),
  classId: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  title: z.string(),
  position: z.number(),
  academicYear: z.string(),
  topics: z.array(topicViewSchema),
  coveragePct: z.number(),
});
const syllabusViewSchema = z.object({ units: z.array(unitViewSchema) });
const subjectSyllabusSchema = z.object({
  subjectId: z.string(),
  subjectName: z.string(),
  coveragePct: z.number(),
  units: z.array(unitViewSchema),
});
const mySyllabusSchema = z.object({ subjects: z.array(subjectSyllabusSchema) });

const yearQuery = z.object({ academicYear: academicYearSchema });

const routes: RouteSpec[] = [
  {
    id: "syllabus.unit-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/syllabus/units",
    summary: "Create a syllabus unit (the subject's teacher)",
    tags: ["syllabus"],
    auth: TEACHER_ONLY,
    request: {
      body: z.object({
        classId: idSchema,
        subjectId: idSchema,
        academicYear: academicYearSchema,
        title: z.string().trim().min(1).max(160),
        position: z.number().int().min(0).default(0),
      }),
    },
    audit: { action: "syllabus.unit-created", resourceType: "syllabus-unit" },
    responses: {
      201: { description: "Created", schema: unitViewSchema },
      403: { description: "Not this subject's teacher", schema: problemSchema },
      404: { description: "No such class/subject", schema: problemSchema },
      409: { description: "Duplicate title for subject/year", schema: problemSchema },
      422: { description: "Subject not of the class's department", schema: problemSchema },
    },
  },
  {
    id: "syllabus.unit-update",
    module: MODULE_NAME,
    method: "PATCH",
    path: "/api/v1/syllabus/units/{unitId}",
    summary: "Update a syllabus unit (the subject's teacher)",
    tags: ["syllabus"],
    auth: TEACHER_ONLY,
    request: {
      params: z.object({ unitId: idSchema }),
      body: z
        .object({
          title: z.string().trim().min(1).max(160).optional(),
          position: z.number().int().min(0).optional(),
        })
        .refine((patch) => patch.title !== undefined || patch.position !== undefined, {
          message: "at least one field required",
        }),
    },
    audit: { action: "syllabus.unit-updated", resourceType: "syllabus-unit" },
    responses: {
      200: { description: "Updated", schema: unitViewSchema },
      403: { description: "Not this subject's teacher", schema: problemSchema },
      404: { description: "No such unit", schema: problemSchema },
    },
  },
  {
    id: "syllabus.unit-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/syllabus/units/{unitId}",
    summary: "Delete a syllabus unit and its topics (the subject's teacher)",
    tags: ["syllabus"],
    auth: TEACHER_ONLY,
    request: { params: z.object({ unitId: idSchema }) },
    audit: { action: "syllabus.unit-deleted", resourceType: "syllabus-unit" },
    responses: {
      200: { description: "Deleted", schema: z.object({ ok: z.literal(true) }) },
      403: { description: "Not this subject's teacher", schema: problemSchema },
      404: { description: "No such unit", schema: problemSchema },
    },
  },
  {
    id: "syllabus.topic-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/syllabus/units/{unitId}/topics",
    summary: "Add a topic to a unit (the subject's teacher)",
    tags: ["syllabus"],
    auth: TEACHER_ONLY,
    request: {
      params: z.object({ unitId: idSchema }),
      body: z.object({
        title: z.string().trim().min(1).max(200),
        position: z.number().int().min(0).default(0),
      }),
    },
    audit: { action: "syllabus.topic-created", resourceType: "syllabus-topic" },
    responses: {
      201: { description: "Created", schema: topicViewSchema },
      403: { description: "Not this subject's teacher", schema: problemSchema },
      404: { description: "No such unit", schema: problemSchema },
    },
  },
  {
    id: "syllabus.topic-update",
    module: MODULE_NAME,
    method: "PATCH",
    path: "/api/v1/syllabus/topics/{topicId}",
    summary: "Update a topic (the subject's teacher)",
    tags: ["syllabus"],
    auth: TEACHER_ONLY,
    request: {
      params: z.object({ topicId: idSchema }),
      body: z
        .object({
          title: z.string().trim().min(1).max(200).optional(),
          position: z.number().int().min(0).optional(),
        })
        .refine((patch) => patch.title !== undefined || patch.position !== undefined, {
          message: "at least one field required",
        }),
    },
    audit: { action: "syllabus.topic-updated", resourceType: "syllabus-topic" },
    responses: {
      200: { description: "Updated", schema: topicViewSchema },
      403: { description: "Not this subject's teacher", schema: problemSchema },
      404: { description: "No such topic", schema: problemSchema },
    },
  },
  {
    id: "syllabus.topic-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/syllabus/topics/{topicId}",
    summary: "Delete a topic (the subject's teacher)",
    tags: ["syllabus"],
    auth: TEACHER_ONLY,
    request: { params: z.object({ topicId: idSchema }) },
    audit: { action: "syllabus.topic-deleted", resourceType: "syllabus-topic" },
    responses: {
      200: { description: "Deleted", schema: z.object({ ok: z.literal(true) }) },
      403: { description: "Not this subject's teacher", schema: problemSchema },
      404: { description: "No such topic", schema: problemSchema },
    },
  },
  {
    id: "syllabus.topic-coverage",
    module: MODULE_NAME,
    method: "PUT",
    path: "/api/v1/syllabus/topics/{topicId}/coverage",
    summary: "Set or clear a topic's coverage (the subject's teacher)",
    tags: ["syllabus"],
    auth: TEACHER_ONLY,
    request: {
      params: z.object({ topicId: idSchema }),
      body: z.object({ taughtOn: dateSchema.nullable() }),
    },
    audit: { action: "syllabus.coverage-set", resourceType: "syllabus-topic" },
    responses: {
      200: { description: "Coverage updated", schema: topicViewSchema },
      403: { description: "Not this subject's teacher", schema: problemSchema },
      404: { description: "No such topic", schema: problemSchema },
    },
  },
  {
    id: "syllabus.class-syllabus",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/syllabus/classes/{classId}/syllabus",
    summary: "A class's syllabus (row-filtered by subject read scope)",
    tags: ["syllabus"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ classId: idSchema }), query: yearQuery },
    responses: {
      200: { description: "Syllabus", schema: syllabusViewSchema },
      404: { description: "No such class", schema: problemSchema },
    },
  },
  {
    id: "syllabus.my",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/syllabus/my",
    summary: "The signed-in student's syllabus, grouped by subject",
    tags: ["syllabus"],
    auth: STUDENT_ONLY,
    request: { query: yearQuery },
    responses: {
      200: { description: "Syllabus by subject", schema: mySyllabusSchema },
      404: { description: "Sign-in not linked to a student", schema: problemSchema },
    },
  },
];

export const syllabusModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
};
