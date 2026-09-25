import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";
import { assessmentTypesInputSchema, assessmentTypeViewSchema } from "./assessment-types";
import { schoolMarksRoutes } from "./marks-contracts";

export const MODULE_NAME = "school-academics";
export const TABLE_PREFIX = "sca_";

const idSchema = z.string().min(1).max(64);
const dateSchema = z.string().date();
const nameSchema = z.string().trim().min(1).max(120);
const academicYearSchema = z.string().trim().min(1).max(32);
/** Non-empty after trimming: a reopen reason of "   " is not a reason. */
const reasonSchema = z.string().trim().min(1).max(500);

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

export const termViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  name: z.string(),
  academicYear: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  status: z.enum(["open", "closed"]),
  closedAt: z.string().nullable(),
  closedBy: z.string().nullable(),
  closedReason: z.string().nullable(),
  marksReleasedAt: z.string().nullable(),
});

const termsResponseSchema = z.object({ terms: z.array(termViewSchema) });

const routes: RouteSpec[] = [
  ...schoolMarksRoutes,
  {
    id: "school-academics.calendar", module: MODULE_NAME, method: "GET",
    path: "/api/v1/school/terms/{termId}/calendar", summary: "Read a term's explicit instructional days and attendance threshold",
    tags: ["school-academics"], auth: ANY_AUTHENTICATED,
    request: { params: z.object({ termId: idSchema }) },
    responses: { 200: { description: "Term calendar", schema: z.object({ termId: idSchema, instructionalDays: z.array(dateSchema).nullable(), shortfallThreshold: z.number().nullable(), version: z.number().int(), locked: z.boolean() }) }, 403: { description: "Outside scope", schema: problemSchema }, 404: { description: "No such term", schema: problemSchema } },
  },
  {
    id: "school-academics.calendar-set", module: MODULE_NAME, method: "PUT",
    path: "/api/v1/school/terms/{termId}/calendar", summary: "Set instructional dates with a version guard",
    tags: ["school-academics"], auth: ANY_AUTHENTICATED,
    request: { params: z.object({ termId: idSchema }), body: z.object({ instructionalDays: z.array(dateSchema).max(400), shortfallThreshold: z.number().int().min(0).max(100), expectedVersion: z.number().int().nonnegative() }) },
    audit: { action: "school-academics.calendar-set", resourceType: "term" },
    responses: { 200: { description: "Saved term calendar", schema: z.object({ termId: idSchema, instructionalDays: z.array(dateSchema).nullable(), shortfallThreshold: z.number().nullable(), version: z.number().int(), locked: z.boolean() }) }, 403: { description: "Outside scope", schema: problemSchema }, 404: { description: "No such term", schema: problemSchema }, 409: { description: "Closed or stale term", schema: problemSchema }, 422: { description: "Invalid dates", schema: problemSchema } },
  },
  {
    id: "school-academics.attendance-shortfall", module: MODULE_NAME, method: "GET",
    path: "/api/v1/school/sections/{sectionId}/attendance-shortfall", summary: "Review daily-register gaps and pupil attendance shortfall",
    tags: ["school-academics"], auth: ANY_AUTHENTICATED,
    request: { params: z.object({ sectionId: idSchema }), query: z.object({ termId: idSchema, through: dateSchema.optional() }) },
    responses: { 200: { description: "Attendance review", schema: z.object({ termId: idSchema, sectionId: idSchema, through: dateSchema, calendarVersion: z.number().int(), threshold: z.number(), scheduledDates: z.array(dateSchema), unsubmittedDates: z.array(dateSchema), students: z.array(z.object({ studentId: idSchema, fullName: z.string(), admissionNo: z.string(), enrollmentDates: z.array(z.object({ from: dateSchema.nullable(), to: dateSchema.nullable() })), dateIssue: z.string().nullable(), expectedDays: z.number().nullable(), recordedDays: z.number().nullable(), absentDays: z.number().nullable(), missingEntryDates: z.array(dateSchema), percentageDenominator: z.number().nullable(), percentage: z.number().nullable(), shortfall: z.boolean().nullable() })) }) }, 403: { description: "Outside scope", schema: problemSchema }, 404: { description: "No such section or term", schema: problemSchema }, 409: { description: "Calendar not configured", schema: problemSchema } },
  },
  {
    id: "school-academics.types-list", module: MODULE_NAME, method: "GET",
    path: "/api/v1/school/terms/{termId}/assessment-types",
    summary: "Read assessment types and percentage weights for a school term",
    tags: ["school-academics"], auth: ANY_AUTHENTICATED,
    request: { params: z.object({ termId: idSchema }) },
    responses: {
      200: { description: "Assessment types", schema: z.object({ types: z.array(assessmentTypeViewSchema), locked: z.boolean() }) },
      403: { description: "Outside scope", schema: problemSchema },
      404: { description: "No such term", schema: problemSchema },
    },
  },
  {
    id: "school-academics.types-set", module: MODULE_NAME, method: "PUT",
    path: "/api/v1/school/terms/{termId}/assessment-types",
    summary: "Replace a term's assessment types with a complete 100% weighting distribution",
    tags: ["school-academics"], auth: ANY_AUTHENTICATED,
    request: { params: z.object({ termId: idSchema }), body: assessmentTypesInputSchema },
    audit: { action: "school-academics.types-configured", resourceType: "term" },
    responses: {
      200: { description: "Saved assessment types", schema: z.object({ types: z.array(assessmentTypeViewSchema) }) },
      403: { description: "Outside scope or not an administrator", schema: problemSchema },
      404: { description: "No such term", schema: problemSchema },
      409: { description: "Term closed or configuration changed", schema: problemSchema },
      422: { description: "Invalid assessment types or weights", schema: problemSchema },
    },
  },
  {
    id: "school-academics.create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/school/terms",
    summary: "Create an academic term (school edition)",
    description:
      "Terms open on creation. `departmentId` is never accepted — a school has no department level (ADR-0023); the row's org position is resolved server-side from the school's one implicit department.",
    tags: ["school-academics"],
    auth: ANY_AUTHENTICATED,
    request: {
      body: z.object({
        collegeId: idSchema,
        name: nameSchema,
        academicYear: academicYearSchema,
        startsOn: dateSchema,
        endsOn: dateSchema,
      }),
    },
    audit: { action: "school-academics.created", resourceType: "term" },
    responses: {
      201: { description: "Created", schema: termViewSchema },
      403: { description: "Outside the caller's scope", schema: problemSchema },
      404: { description: "No such school", schema: problemSchema },
      409: { description: "A term of that name already exists in that academic year", schema: problemSchema },
      422: { description: "The term would end before it starts", schema: problemSchema },
    },
  },
  {
    id: "school-academics.list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/school/terms",
    summary: "Terms the caller can see, newest first",
    description:
      "Row-filtered by the shared ScopeChecker: a term the caller holds no covering grant for is simply absent.",
    tags: ["school-academics"],
    auth: ANY_AUTHENTICATED,
    request: { query: z.object({ academicYear: academicYearSchema.optional() }) },
    responses: {
      200: { description: "Visible terms", schema: termsResponseSchema },
    },
  },
  {
    id: "school-academics.close",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/school/terms/{termId}/close",
    summary: "Close a term",
    tags: ["school-academics"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ termId: idSchema }),
      body: z.object({ reason: reasonSchema.optional() }),
    },
    audit: { action: "school-academics.closed", resourceType: "term" },
    responses: {
      200: { description: "Closed", schema: termViewSchema },
      403: { description: "Outside the caller's scope", schema: problemSchema },
      404: { description: "No such term", schema: problemSchema },
      409: { description: "Already closed", schema: problemSchema },
    },
  },
  {
    id: "school-academics.reopen",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/school/terms/{termId}/reopen",
    summary: "Reopen a closed term — a non-empty reason is MANDATORY and audited",
    description:
      "The asymmetry with college publication is deliberate (plan §4 Part 3): a school term has a real, reopenable lifecycle, and every reopen is on the record with the reason its admin gave.",
    tags: ["school-academics"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ termId: idSchema }),
      body: z.object({ reason: reasonSchema }),
    },
    audit: { action: "school-academics.reopened", resourceType: "term" },
    responses: {
      200: { description: "Reopened", schema: termViewSchema },
      403: { description: "Outside the caller's scope", schema: problemSchema },
      404: { description: "No such term", schema: problemSchema },
      409: { description: "Already open", schema: problemSchema },
      422: { description: "Missing or blank reason", schema: problemSchema },
    },
  },
  {
    id: "school-academics.release-marks",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/school/terms/{termId}/release-marks",
    summary: "Release marks for a closed term that predates this feature",
    tags: ["school-academics"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ termId: idSchema }) },
    audit: { action: "school-academics.marks-released", resourceType: "term" },
    responses: {
      200: { description: "Marks released", schema: termViewSchema },
      403: { description: "Outside the caller's scope", schema: problemSchema },
      404: { description: "No such term", schema: problemSchema },
      409: { description: "Term open, already released, or changed", schema: problemSchema },
    },
  },
];

/**
 * Static module definition. `editions: ["school"]` means a college install
 * never registers this module: its endpoints 404 there, they do not 403.
 */
export const schoolAcademicsModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
  editions: ["school"],
};
