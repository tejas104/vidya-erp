import { z } from "zod";
import type { JobSpec, ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "analytics";
export const TABLE_PREFIX = "anl_";

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');
export const scopeLevelSchema = z.enum(["section", "class", "department", "college"]);

const monthlyPointSchema = z.object({ month: z.string(), pct: z.number() });
const attendanceSummarySchema = z.object({
  pct: z.number(),
  sessions: z.number(),
  distinctStudents: z.number(),
  monthly: z.array(monthlyPointSchema),
});
const marksSummarySchema = z.object({
  avgPct: z.number(),
  nMarks: z.number(),
  distinctStudents: z.number(),
  monthly: z.array(z.object({ month: z.string(), avgPct: z.number() })),
});

/** An aggregate slot: value, or a DESIGNED withheld/empty state (ADR-0018). */
const aggStateSchema = (value: z.ZodTypeAny) =>
  z.discriminatedUnion("state", [
    z.object({ state: z.literal("ok"), value }),
    z.object({ state: z.literal("insufficient-cohort"), minCohort: z.number() }),
    z.object({ state: z.literal("no-data") }),
    z.object({ state: z.literal("denied"), deniedSubjectId: z.string().optional() }),
  ]);

const atRiskEntrySchema = z.object({
  studentId: z.string(),
  name: z.string(),
  attendancePct: z.number().nullable(),
  subjectPcts: z.record(z.string(), z.number()),
  overallPct: z.number().nullable(),
  reasons: z.array(z.enum(["low-attendance", "low-marks"])),
});

const stripSchema = z.array(
  z.object({
    sectionId: z.string(),
    name: z.string(),
    days: z.array(z.object({ heldOn: z.string(), presentPct: z.number() })),
  }),
);

const dashboardSchema = z.object({
  academicYear: z.string(),
  names: z.record(z.string(), z.string()),
  tiles: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("teacher-class"),
        classId: z.string(),
        subjectId: z.string(),
        attendance: aggStateSchema(attendanceSummarySchema),
        marks: aggStateSchema(marksSummarySchema),
        atRisk: z.number(),
        strip: stripSchema,
      }),
      z.object({
        type: z.literal("class"),
        classId: z.string(),
        attendance: aggStateSchema(attendanceSummarySchema),
        marks: aggStateSchema(marksSummarySchema),
        atRisk: z.number(),
        strip: stripSchema,
      }),
      z.object({
        type: z.literal("department"),
        departmentId: z.string(),
        attendance: aggStateSchema(attendanceSummarySchema),
        marks: aggStateSchema(marksSummarySchema),
        atRisk: z.number(),
      }),
      z.object({
        type: z.literal("college"),
        collegeId: z.string(),
        attendance: aggStateSchema(attendanceSummarySchema),
        marks: aggStateSchema(marksSummarySchema),
        atRisk: z.number(),
      }),
    ]),
  ),
});

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };
const yearQuery = z.object({ academicYear: academicYearSchema });

const routes: RouteSpec[] = [
  {
    id: "analytics.dashboard",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/analytics/dashboard",
    summary: "The caller's role-adaptive dashboard (the permission mirror)",
    description:
      "Tiles are derived from the caller's grants — the response contains only nodes their scope covers, and every number inside is served under constituent-closure + the minimum-cohort rule (ADR-0018).",
    tags: ["analytics"],
    auth: ANY_AUTHENTICATED,
    request: { query: yearQuery },
    responses: { 200: { description: "Scope-derived tiles", schema: dashboardSchema } },
  },
  {
    id: "analytics.rollup",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/analytics/rollups/{level}/{nodeId}",
    summary: "Attendance + marks rollups for one org node",
    description:
      "Attendance and single-subject marks check the node's constituent ref; the cross-subject overall is served only under explicit per-subject closure. Aggregates under the minimum cohort are withheld as a designed state.",
    tags: ["analytics"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ level: scopeLevelSchema, nodeId: idSchema }),
      query: yearQuery,
    },
    responses: {
      200: {
        description: "Scope-served rollups",
        schema: z.object({
          node: z.object({ level: scopeLevelSchema, nodeId: z.string(), name: z.string() }),
          attendance: aggStateSchema(attendanceSummarySchema),
          marks: z.object({
            bySubject: z.array(
              z.object({
                subjectId: z.string(),
                name: z.string(),
                summary: aggStateSchema(marksSummarySchema),
              }),
            ),
            overall: aggStateSchema(marksSummarySchema),
          }),
        }),
      },
      403: { description: "The caller's scope covers nothing at this node", schema: problemSchema },
      404: { description: "No such org node", schema: problemSchema },
    },
  },
  {
    id: "analytics.at-risk",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/analytics/at-risk/{level}/{nodeId}",
    summary: "At-risk students under a node (field-gated per caller)",
    description:
      "Each entry is component-gated: attendance figures for callers covering the student's section; per-subject scores per subject scope; the overall figure and the low-marks reason only under full cross-subject closure. Entries with no visible flagged reason are omitted.",
    tags: ["analytics"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ level: scopeLevelSchema, nodeId: idSchema }),
      query: yearQuery,
    },
    responses: {
      200: { description: "Visible at-risk entries", schema: z.object({ students: z.array(atRiskEntrySchema) }) },
      404: { description: "No such org node", schema: problemSchema },
    },
  },
  {
    id: "analytics.student-performance",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/analytics/students/{studentId}/performance",
    summary: "One student's attendance + marks trends (live, filtered at source)",
    description:
      "Computed fresh from #4's read model with the ScopeChecker run PER RECORD before any arithmetic. The overall average appears only when no mark was filtered out (closure).",
    tags: ["analytics"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ studentId: idSchema }),
      query: yearQuery,
    },
    responses: {
      200: {
        description: "The caller's view of this student",
        schema: z.object({
          studentId: z.string(),
          name: z.string(),
          attendance: z
            .object({ pct: z.number(), total: z.number(), monthly: z.array(monthlyPointSchema) })
            .nullable(),
          subjects: z.array(
            z.object({
              subjectId: z.string(),
              name: z.string(),
              avgPct: z.number(),
              series: z.array(z.object({ label: z.string(), pct: z.number() })),
            }),
          ),
          overallPct: z.number().nullable(),
        }),
      },
      403: { description: "No record of this student is within the caller's scope", schema: problemSchema },
      404: { description: "No such student", schema: problemSchema },
    },
  },
  {
    id: "analytics.recompute",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/analytics/recompute",
    summary: "Rebuild a year's rollups now (admin)",
    description: "Enqueues the same worker job the nightly schedule runs. Audited.",
    tags: ["analytics"],
    auth: ADMIN_ONLY,
    request: { body: z.object({ academicYear: academicYearSchema }) },
    audit: { action: "analytics.recompute-requested", resourceType: "rollup" },
    responses: {
      202: { description: "Rebuild enqueued", schema: z.object({ enqueued: z.literal(true) }) },
    },
  },
];

export const ROLLUP_JOB_NAME = "rollup-rebuild";
export const ROLLUP_SCHEDULER_ID = "analytics-rollup-rebuild";
export const rollupJobPayloadSchema = z.object({
  /** Explicit year, or derived from the current date by the processor. */
  academicYear: academicYearSchema.optional(),
  source: z.string().min(1),
});

const jobs: JobSpec[] = [
  {
    name: ROLLUP_JOB_NAME,
    module: MODULE_NAME,
    summary:
      "Nightly precomputation: pages the year's attendance and marks through #4's read model into per-node rollups and at-risk flags (blind compute; disclosure happens only at serve time).",
    payloadSchema: rollupJobPayloadSchema,
  },
];

export const analyticsModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs,
};

/** "2026-07-15" → "2026-27" (academic year rolls in June). */
export function academicYearForDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
