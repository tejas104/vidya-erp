import { z } from "zod";
import type { JobSpec, ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "reporting";
export const TABLE_PREFIX = "rpt_";

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');
export const formatSchema = z.enum(["pdf", "csv"]);
export const scopeLevelSchema = z.enum(["section", "class", "department", "college"]);

export const reportParamsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("student-performance"), studentId: idSchema }),
  z.object({ kind: z.literal("section-attendance"), sectionId: idSchema }),
  z.object({ kind: z.literal("marks-summary"), classId: idSchema }),
  z.object({ kind: z.literal("at-risk"), level: scopeLevelSchema, nodeId: idSchema }),
  // --- results ---
  z.object({ kind: z.literal("grade-card"), studentId: idSchema }),
  // --- exams ---
  z.object({ kind: z.literal("hall-ticket"), studentId: idSchema }),
]);

const reportViewSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "student-performance",
    "section-attendance",
    "marks-summary",
    "at-risk",
    "grade-card",
    "hall-ticket",
  ]),
  format: formatSchema,
  academicYear: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  rows: z.number(),
  error: z.string().nullable(),
  createdAt: z.string(),
});

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ANY_AUTHENTICATED = { public: false as const, requirement: {} };
const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };

const routes: RouteSpec[] = [
  {
    id: "reporting.class-credentials",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/reports/class-credentials/{classId}",
    summary: "Issue logins for a class's students who lack one and return a printable credential sheet (admin)",
    description:
      "SYNCHRONOUS, not the queued request/poll/download flow above: the sheet is generated in this request " +
      "handler and streamed straight back as the response body. It is never written to object storage or any " +
      "other durable store — there is no reportId, nothing to poll, and no download route for it (#11 D-ruling: " +
      "a temporary password cannot be re-fetched at job time, so the queued flow structurally cannot produce it, " +
      "and not persisting it is strictly better security besides). Every student in the class who does not " +
      "already have a login gets one (identity.issueCredential, active, no force-change — #11 D2); students who " +
      "already have a login are skipped (their password was never stored, so it cannot be reprinted) and simply " +
      "do not appear on the sheet. A student a login could not be issued or linked for (e.g. a derived-username " +
      "collision with another college) is listed on a trailing page of the sheet with the reason, never silently " +
      "dropped. Capped at 200 students without a login per request — issuing more synchronously risks a timeout " +
      "mid-batch, which would leave accounts created with their password never printed. Admin-only, scope-checked " +
      "against the class's college, audited with the issued and skipped counts — never the plaintext.",
    tags: ["reporting"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ classId: idSchema }) },
    audit: { action: "reporting.class-credentials-issued", resourceType: "class" },
    responses: {
      200: { description: "The credential sheet, one page", contentType: "application/pdf" },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such class", schema: problemSchema },
      422: { description: "Too many students without a login for one synchronous request", schema: problemSchema },
    },
  },
  {
    id: "reporting.request",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/reports",
    summary: "Request a report (202 + poll)",
    description:
      "The requested target is scope-checked against the caller before the job is enqueued (403 if they couldn't read the underlying records). Generation runs in the worker with the caller's scope snapshot; the report is a disclosure surface — it inherits constituent-closure and the minimum-cohort rule (ADR-0018/0020).",
    tags: ["reporting"],
    auth: ANY_AUTHENTICATED,
    request: {
      body: z.object({
        format: formatSchema,
        academicYear: academicYearSchema,
        report: reportParamsSchema,
      }),
    },
    audit: { action: "reporting.report-requested", resourceType: "report" },
    responses: {
      202: { description: "Report accepted and enqueued", schema: z.object({ reportId: z.string() }) },
      403: { description: "The target is outside the caller's scope", schema: problemSchema },
      404: { description: "No such target (student / section / class / node)", schema: problemSchema },
    },
  },
  {
    id: "reporting.list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/reports",
    summary: "List the caller's recent reports",
    tags: ["reporting"],
    auth: ANY_AUTHENTICATED,
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }) },
    responses: { 200: { description: "Recent reports", schema: z.object({ reports: z.array(reportViewSchema) }) } },
  },
  {
    id: "reporting.status",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/reports/{reportId}",
    summary: "Report status (requester only)",
    tags: ["reporting"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ reportId: idSchema }) },
    responses: {
      200: { description: "Report state", schema: reportViewSchema },
      403: { description: "Not the requester", schema: problemSchema },
      404: { description: "No such report", schema: problemSchema },
    },
  },
  {
    id: "reporting.download",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/reports/{reportId}/download",
    summary: "Download the generated artifact (scope-checked, not URL-secret)",
    description:
      "Downloadable only by its requester AND only while their current scope still covers the target — an out-of-scope caller (URL guess) or a requester whose scope was revoked gets 403 before any bytes are read. Every download is audited (ADR-0020).",
    tags: ["reporting"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ reportId: idSchema }) },
    responses: {
      200: { description: "The PDF or CSV artifact", contentType: "application/octet-stream" },
      403: { description: "Not the requester, or outside current scope", schema: problemSchema },
      404: { description: "No such report", schema: problemSchema },
      409: { description: "Report is not ready yet", schema: problemSchema },
    },
  },
];

export const REPORT_JOB_NAME = "report-generate";
export const reportJobPayloadSchema = z.object({
  reportId: idSchema,
  source: z.string().min(1),
});

const jobs: JobSpec[] = [
  {
    name: REPORT_JOB_NAME,
    module: MODULE_NAME,
    summary:
      "Generates a report with the requester's scope snapshot (scope-filtered via the analytics read model), uploads the PDF/CSV to object storage, and audits actor + kind + scope + counts.",
    payloadSchema: reportJobPayloadSchema,
  },
];

export const reportingModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs,
};
