import { z } from "zod";
import type { JobSpec, ModuleDefinition, RouteSpec } from "@vidya/platform";
import { reportCardPreviewSchema, rosterStudentSchema } from "./school/report-card-contract";
import { documentFamilySchema, documentStyleSchema, sampleSchema } from "./school/document-format";
import { UPLOAD_BODY_MAX_BYTES } from "@vidya/platform";

export const MODULE_NAME = "reporting";
export const TABLE_PREFIX = "rpt_";

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');
export const formatSchema = z.enum(["pdf", "csv", "xlsx"]);
export const scopeLevelSchema = z.enum(["section", "class", "department", "college"]);
const schoolDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "valid calendar date required");

export const reportParamsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("student-performance"), studentId: idSchema }),
  z.object({ kind: z.literal("section-attendance"), sectionId: idSchema }),
  z.object({ kind: z.literal("teacher-attendance"), collegeId: idSchema, date: schoolDateSchema }),
  z.object({ kind: z.literal("school-attendance-review"), sectionId: idSchema, termId: idSchema, through: schoolDateSchema }),
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
    "teacher-attendance",
    "school-attendance-review",
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
const GUARDIAN_ONLY = { public: false as const, requirement: { audience: "guardian" as const } };
const SCHOOL_LEADERS = { public: false as const, requirement: { rolesAnyOf: ["admin" as const, "principal" as const] } };
const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };

const routes: RouteSpec[] = [
  {
    id: "reporting.school-certificate-issue", module: MODULE_NAME, method: "POST",
    path: "/api/v1/school/certificates", summary: "Issue a source-checked bonafide certificate; transfer waits for approval policy",
    tags: ["reporting", "school"], auth: SCHOOL_LEADERS,
    request: { body: z.object({ studentId: idSchema, enrollmentId: idSchema,
      kind: z.enum(["bonafide", "transfer"]), correctionOfId: idSchema.optional(),
      idempotencyKey: z.string().uuid() }).strict() },
    audit: { action: "reporting.school-certificate-issue-requested", resourceType: "certificate" },
    responses: {
      201: { description: "Immutable certificate issued", schema: z.object({ certificateId: idSchema,
        number: z.string(), issuedAt: z.string(), replay: z.literal(false) }) },
      200: { description: "Identical request replayed", schema: z.object({ certificateId: idSchema,
        number: z.string(), issuedAt: z.string(), replay: z.literal(true) }) },
      403: { description: "Outside school leadership scope", schema: problemSchema },
      404: { description: "No verified source enrollment", schema: problemSchema },
      409: { description: "Transfer source or correction conflict", schema: problemSchema },
    },
  },
  {
    id: "reporting.school-certificates-for-student", module: MODULE_NAME, method: "GET",
    path: "/api/v1/school/certificates/students/{studentId}", summary: "List a pupil's issued certificates",
    tags: ["reporting", "school"], auth: SCHOOL_LEADERS,
    request: { params: z.object({ studentId: idSchema }) },
    audit: { action: "reporting.school-certificates-viewed", resourceType: "student" },
    responses: { 200: { description: "Visible immutable certificate records" },
      403: { description: "Outside leadership scope", schema: problemSchema },
      404: { description: "No such pupil", schema: problemSchema } },
  },
  {
    id: "reporting.school-certificate-download", module: MODULE_NAME, method: "GET",
    path: "/api/v1/school/certificates/{certificateId}/download", summary: "Download a stored certificate as PDF",
    tags: ["reporting", "school"], auth: SCHOOL_LEADERS,
    request: { params: z.object({ certificateId: idSchema }) },
    audit: { action: "reporting.school-certificate-downloaded", resourceType: "certificate" },
    responses: { 200: { description: "Immutable certificate PDF", contentType: "application/pdf" },
      403: { description: "Outside current leadership scope", schema: problemSchema },
      404: { description: "No such certificate", schema: problemSchema },
      409: { description: "Stored version cannot be rendered", schema: problemSchema } },
  },
  {
    id: "reporting.school-document-format-get", module: MODULE_NAME, method: "GET",
    path: "/api/v1/school/document-formats/{collegeId}/{family}",
    summary: "Read a school's controlled document format (administrator)", tags: ["reporting"], auth: ADMIN_ONLY,
    request: { params: z.object({ collegeId: idSchema, family: documentFamilySchema }) },
    responses: { 200: { description: "Current format and sample metadata" }, 403: { description: "Access denied", schema: problemSchema } },
  },
  {
    id: "reporting.school-document-format-save", module: MODULE_NAME, method: "PUT",
    path: "/api/v1/school/document-formats/{collegeId}/{family}",
    summary: "Append a school document-format version; optional PDF/DOCX sample is reference only", tags: ["reporting"], auth: ADMIN_ONLY,
    request: { params: z.object({ collegeId: idSchema, family: documentFamilySchema }),
      body: z.object({ expectedVersion: z.number().int().min(0), style: documentStyleSchema, sample: sampleSchema.optional() }).strict() },
    bodyMaxBytes: UPLOAD_BODY_MAX_BYTES,
    audit: { action: "reporting.school-document-format-saved", resourceType: "college" },
    responses: { 200: { description: "Saved format version" }, 403: { description: "Access denied", schema: problemSchema },
      409: { description: "Format changed since it was read", schema: problemSchema }, 422: { description: "Invalid sample", schema: problemSchema } },
  },
  {
    id: "reporting.school-document-format-sample", module: MODULE_NAME, method: "GET",
    path: "/api/v1/school/document-formats/{collegeId}/{family}/sample",
    summary: "Download the uploaded format reference (administrator)", tags: ["reporting"], auth: ADMIN_ONLY,
    request: { params: z.object({ collegeId: idSchema, family: documentFamilySchema }) },
    audit: { action: "reporting.school-document-format-sample-downloaded", resourceType: "college" },
    responses: { 200: { description: "Uploaded sample", contentType: "application/octet-stream" },
      403: { description: "Access denied", schema: problemSchema } },
  },
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
      200: { description: "The PDF, Excel, or CSV artifact", contentType: "application/octet-stream" },
      403: { description: "Not the requester, or outside current scope", schema: problemSchema },
      404: { description: "No such report", schema: problemSchema },
      409: { description: "Report is not ready yet", schema: problemSchema },
    },
  },
  // -------------------------------------------------------------------------
  // School report cards (immutable snapshots).
  //
  // A separate route family from the queued /api/v1/reports flow above: these
  // are synchronous and their artifact is a permanent academic record, not a
  // transient export. Every one of the four resolves the target's real org
  // path on the server and scope-checks it — the class id in a path and the
  // snapshot id in a download URL are identifiers, never authority.
  // -------------------------------------------------------------------------
  {
    id: "reporting.school-report-card-desk-scope",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/school/report-cards/desk-scope",
    summary: "Classes and terms available to the report-card desk",
    description: "Class choices are resolved from current grants and checked against each stored class path. Terms are returned only for schools with a readable class. The response never includes a school-wide organization tree.",
    tags: ["reporting", "school"],
    auth: ANY_AUTHENTICATED,
    responses: {
      200: { description: "Report-card desk choices", schema: z.object({
        classes: z.array(z.object({ id: z.string(), collegeId: z.string(), name: z.string(), canPublish: z.boolean() })),
        terms: z.array(z.object({ id: z.string(), collegeId: z.string(), name: z.string(), academicYear: z.string(), startsOn: z.string().date(), endsOn: z.string().date() })),
      }) },
    },
  },
  {
    id: "reporting.school-report-card-roster",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/school/report-cards/classes/{classId}",
    summary: "A class roster with each pupil's latest report-card snapshot for a term",
    description:
      "Scope-checked against the resolved class. Returns every enrolled pupil with the id and timestamp of their most recent snapshot for this term, or nulls when none has been generated.",
    tags: ["reporting", "school"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ classId: idSchema }),
      query: z.object({ termId: idSchema }),
    },
    responses: {
      200: { description: "Roster with snapshot state", schema: z.object({ students: z.array(rosterStudentSchema) }) },
      403: { description: "The class is outside the caller's scope", schema: problemSchema },
      404: { description: "No such class or term", schema: problemSchema },
      422: { description: "The term does not belong to this class's school", schema: problemSchema },
    },
  },
  {
    id: "reporting.school-report-card-preview",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/school/report-cards/preview",
    summary: "Compute a pupil's report card without storing anything",
    description:
      "Computes exactly what generation would store, so the user approves the figures they will issue. It persists no report card — but it is still a POST that discloses a pupil's entire academic standing, so it is audited like any other disclosure (ADR-0020, Constitution rule 7).",
    tags: ["reporting", "school"],
    auth: ANY_AUTHENTICATED,
    request: { body: z.object({ studentId: idSchema, termId: idSchema }) },
    audit: { action: "reporting.school-report-card-previewed", resourceType: "student" },
    responses: {
      200: { description: "The computed report card", schema: reportCardPreviewSchema },
      403: { description: "The pupil is outside the caller's scope", schema: problemSchema },
      404: { description: "No such pupil or term", schema: problemSchema },
      422: { description: "The pupil is not enrolled in a class for this term", schema: problemSchema },
    },
  },
  {
    id: "reporting.school-report-card-generate",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/school/report-cards",
    summary: "Issue an immutable report-card snapshot",
    description:
      "Persists the computed report card as a permanent, append-only record and audits the issue. Generating again does NOT overwrite: it appends a new snapshot and leaves the superseded one exactly as issued, so a report card a family already holds can always be reproduced.",
    tags: ["reporting", "school"],
    auth: ANY_AUTHENTICATED,
    request: { body: z.object({ studentId: idSchema, termId: idSchema }) },
    audit: { action: "reporting.school-report-card-generated", resourceType: "student" },
    responses: {
      201: { description: "Snapshot issued", schema: z.object({ snapshotId: z.string(), generatedAt: z.string() }) },
      403: { description: "The pupil is outside the caller's scope", schema: problemSchema },
      404: { description: "No such pupil or term", schema: problemSchema },
      422: { description: "The pupil is not enrolled in a class for this term", schema: problemSchema },
    },
  },
  {
    id: "reporting.school-report-card-download",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/school/report-cards/{snapshotId}/download",
    summary: "Render a stored snapshot as PDF (scope-checked, not URL-secret)",
    description:
      "Renders FROM the stored snapshot and never by recomputation, so the document is byte-stable against later mark corrections. Authorized against the caller's CURRENT scope using the org path recorded on the snapshot — a guessed snapshot id, or a caller whose scope was revoked, gets 403 before any bytes are produced. Every download is audited (ADR-0020).",
    tags: ["reporting", "school"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ snapshotId: idSchema }) },
    audit: { action: "reporting.school-report-card-downloaded", resourceType: "report" },
    responses: {
      200: { description: "The report-card PDF", contentType: "application/pdf" },
      403: { description: "Outside the caller's current scope", schema: problemSchema },
      404: { description: "No such snapshot", schema: problemSchema },
    },
  },
  ...(["publish", "withdraw"] as const).map((action): RouteSpec => ({
    id: `reporting.school-report-card-${action}`,
    module: MODULE_NAME,
    method: "POST",
    path: `/api/v1/school/report-cards/{snapshotId}/${action}`,
    summary: `${action === "publish" ? "Publish" : "Withdraw"} a specific report-card snapshot for family`,
    tags: ["reporting", "school"],
    auth: SCHOOL_LEADERS,
    request: { params: z.object({ snapshotId: idSchema }) },
    audit: { action: action === "publish" ? "reporting.school-report-card-published" : "reporting.school-report-card-withdrawn", resourceType: "report" },
    responses: {
      200: { description: "Publication changed", schema: z.object({ snapshotId: z.string(), publicationState: z.enum(["published", "withdrawn"]) }) },
      403: { description: "Outside school leadership scope", schema: problemSchema },
      404: { description: "No such snapshot", schema: problemSchema },
      409: { description: "Publication state changed already", schema: problemSchema },
    },
  })),
  {
    id: "reporting.child-report-cards",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/school/report-cards/children/{studentId}",
    summary: "Report cards released to this child's family",
    tags: ["reporting", "family"],
    auth: GUARDIAN_ONLY,
    request: { params: z.object({ studentId: idSchema }) },
    audit: { action: "reporting.family-report-cards-viewed", resourceType: "student" },
    responses: {
      200: { description: "Currently published cards", schema: z.object({ reportCards: z.array(z.object({
        snapshotId: z.string(), termId: z.string(), termName: z.string(), academicYear: z.string(), generatedAt: z.string(),
        overall: z.object({ percentage: z.number().nullable(), grade: z.string().nullable(), complete: z.boolean() }),
        attendance: z.object({ percentage: z.number().nullable(), complete: z.boolean() }),
      })) }) },
      403: { description: "No current family access", schema: problemSchema },
    },
  },
  {
    id: "reporting.child-report-card-download",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/school/report-cards/children/{studentId}/{snapshotId}/download",
    summary: "Download a currently published report card for this child",
    tags: ["reporting", "family"],
    auth: GUARDIAN_ONLY,
    request: { params: z.object({ studentId: idSchema, snapshotId: idSchema }) },
    audit: { action: "reporting.family-report-card-downloaded", resourceType: "report" },
    responses: {
      200: { description: "Published report-card PDF", contentType: "application/pdf" },
      403: { description: "No current family access or publication", schema: problemSchema },
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
      "Generates a report with the requester's scope snapshot (scope-filtered via the analytics read model), uploads the PDF/Excel/CSV artifact to object storage, and audits actor + kind + scope + counts.",
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
