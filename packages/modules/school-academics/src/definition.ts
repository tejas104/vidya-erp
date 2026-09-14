import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "school-terms";
export const TABLE_PREFIX = "sch_";

const idSchema = z.string().min(1).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date like "2026-04-01"');
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
});

const termsResponseSchema = z.object({ terms: z.array(termViewSchema) });

const routes: RouteSpec[] = [
  {
    id: "school-terms.create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/school/terms",
    summary: "Create an academic term (school edition)",
    description:
      "Terms open on creation. `departmentId` is never accepted — a school has no department level (ADR-0023); the row's org position is resolved server-side from the school's one implicit department.",
    tags: ["school-terms"],
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
    audit: { action: "school-terms.created", resourceType: "term" },
    responses: {
      201: { description: "Created", schema: termViewSchema },
      403: { description: "Outside the caller's scope", schema: problemSchema },
      404: { description: "No such school", schema: problemSchema },
      409: { description: "A term of that name already exists in that academic year", schema: problemSchema },
      422: { description: "The term would end before it starts", schema: problemSchema },
    },
  },
  {
    id: "school-terms.list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/school/terms",
    summary: "Terms the caller can see, newest first",
    description:
      "Row-filtered by the shared ScopeChecker: a term the caller holds no covering grant for is simply absent.",
    tags: ["school-terms"],
    auth: ANY_AUTHENTICATED,
    request: { query: z.object({ academicYear: academicYearSchema.optional() }) },
    responses: {
      200: { description: "Visible terms", schema: termsResponseSchema },
    },
  },
  {
    id: "school-terms.close",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/school/terms/{termId}/close",
    summary: "Close a term",
    tags: ["school-terms"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ termId: idSchema }),
      body: z.object({ reason: reasonSchema.optional() }),
    },
    audit: { action: "school-terms.closed", resourceType: "term" },
    responses: {
      200: { description: "Closed", schema: termViewSchema },
      403: { description: "Outside the caller's scope", schema: problemSchema },
      404: { description: "No such term", schema: problemSchema },
      409: { description: "Already closed", schema: problemSchema },
    },
  },
  {
    id: "school-terms.reopen",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/school/terms/{termId}/reopen",
    summary: "Reopen a closed term — a non-empty reason is MANDATORY and audited",
    description:
      "The asymmetry with college publication is deliberate (plan §4 Part 3): a school term has a real, reopenable lifecycle, and every reopen is on the record with the reason its admin gave.",
    tags: ["school-terms"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ termId: idSchema }),
      body: z.object({ reason: reasonSchema }),
    },
    audit: { action: "school-terms.reopened", resourceType: "term" },
    responses: {
      200: { description: "Reopened", schema: termViewSchema },
      403: { description: "Outside the caller's scope", schema: problemSchema },
      404: { description: "No such term", schema: problemSchema },
      409: { description: "Already open", schema: problemSchema },
      422: { description: "Missing or blank reason", schema: problemSchema },
    },
  },
];

/**
 * Static module definition. `editions: ["school"]` means a college install
 * never registers this module: its endpoints 404 there, they do not 403.
 */
export const schoolTermsModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
  editions: ["school"],
};
