import { z } from "zod";
import type { JobSpec, ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "academics";
export const TABLE_PREFIX = "acd_";

// ---------------------------------------------------------------------------
// Shared schemas (OpenAPI source, ADR-0007)
// ---------------------------------------------------------------------------

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD");
export const slotSchema = z.string().trim().min(1).max(32);
export const attendanceStatusSchema = z.enum(["present", "absent", "late", "excused"]);
/** ADR-0017: assessment types are a fixed taxonomy, not CRUD-able rows. */
export const assessmentKindSchema = z.enum(["exam", "quiz", "assignment"]);
export const scoreSchema = z.number().min(0).max(9999.99);

export const attendanceEntryInputSchema = z.object({
  studentId: idSchema,
  status: attendanceStatusSchema,
});

export const sessionViewSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  /** "" for a whole-section session; a subject id for a subject teacher's period. */
  subjectId: z.string(),
  heldOn: z.string(),
  slot: z.string(),
  academicYear: z.string(),
  takenBy: z.string(),
  entries: z.array(z.object({ studentId: z.string(), status: attendanceStatusSchema })),
});

export const assessmentViewSchema = z.object({
  id: z.string(),
  classId: z.string(),
  subjectId: z.string(),
  kind: assessmentKindSchema,
  name: z.string(),
  academicYear: z.string(),
  maxScore: z.number(),
  heldOn: z.string().nullable(),
});

export const markViewSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  studentId: z.string(),
  score: z.number(),
  recordedBy: z.string(),
  updatedAt: z.string(),
});

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const invalidEntriesSchema = z.object({
  message: z.string(),
  invalid: z.array(z.object({ studentId: z.string(), reason: z.string() })),
});

const TEACHER_ONLY = { public: false as const, requirement: { rolesAnyOf: ["teacher" as const] } };
/**
 * Attendance is now written by a subject teacher (their own period) OR the
 * class teacher (whole-section session / corrections). This is only the
 * coarse role gate; the ScopeChecker enforces per-record authority (a
 * subject teacher may write ONLY their subject's period).
 */
const TEACHER_OR_CLASS_TEACHER = {
  public: false as const,
  requirement: { rolesAnyOf: ["teacher" as const, "class_teacher" as const] },
};
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

// ---------------------------------------------------------------------------
// Routes — record-level authority is the ScopeChecker against each record's
// stored org path (+ subjectId for marks); the role gates below only mirror
// who could ever pass the matrix.
// ---------------------------------------------------------------------------

const routes: RouteSpec[] = [
  {
    id: "academics.attendance-record",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/academics/attendance/sessions",
    summary: "Record a session's attendance (subject teacher's period, or a class teacher's whole-section session)",
    description:
      "Creates the session with the full roster's entries in one call. Pass a subjectId to record a subject teacher's own period (a SUBJECT record — only that subject's teacher may write it); omit it for a whole-section session (only the class teacher). Every entry must belong to the section's live roster.",
    tags: ["academics-attendance"],
    auth: TEACHER_OR_CLASS_TEACHER,
    request: {
      body: z.object({
        sectionId: idSchema,
        subjectId: idSchema.optional(),
        heldOn: dateSchema,
        slot: slotSchema.default("day"),
        academicYear: academicYearSchema,
        entries: z.array(attendanceEntryInputSchema).min(1).max(500),
      }),
    },
    audit: { action: "academics.attendance-recorded", resourceType: "attendance-session" },
    responses: {
      201: { description: "Session recorded", schema: sessionViewSchema },
      404: { description: "No such section", schema: problemSchema },
      409: { description: "Session already exists for this section/date/slot", schema: problemSchema },
      422: { description: "Entries outside the section's live roster", schema: invalidEntriesSchema },
    },
  },
  {
    id: "academics.attendance-correct",
    module: MODULE_NAME,
    method: "PATCH",
    path: "/api/v1/academics/attendance/sessions/{sessionId}/entries/{studentId}",
    summary: "Correct one attendance entry (owning subject teacher or the class teacher; audited with before/after)",
    tags: ["academics-attendance"],
    auth: TEACHER_OR_CLASS_TEACHER,
    request: {
      params: z.object({ sessionId: idSchema, studentId: idSchema }),
      body: z.object({ status: attendanceStatusSchema }),
    },
    audit: { action: "academics.attendance-corrected", resourceType: "attendance-entry" },
    responses: {
      200: { description: "Entry corrected", schema: z.object({ studentId: z.string(), status: attendanceStatusSchema }) },
      404: { description: "No such session or entry", schema: problemSchema },
    },
  },
  {
    id: "academics.attendance-session-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/academics/attendance/sessions/{sessionId}",
    summary: "One session with its entries",
    tags: ["academics-attendance"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ sessionId: idSchema }) },
    responses: {
      200: { description: "The session", schema: sessionViewSchema },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such session", schema: problemSchema },
    },
  },
  {
    id: "academics.section-attendance",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/academics/sections/{sectionId}/attendance",
    summary: "A section's sessions in a date range",
    tags: ["academics-attendance"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ sectionId: idSchema }),
      query: z.object({
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    },
    responses: {
      200: {
        description: "Sessions (entry counts, newest first)",
        schema: z.object({
          sessions: z.array(
            z.object({
              id: z.string(),
              subjectId: z.string(),
              heldOn: z.string(),
              slot: z.string(),
              academicYear: z.string(),
              counts: z.object({
                present: z.number(),
                absent: z.number(),
                late: z.number(),
                excused: z.number(),
              }),
            }),
          ),
        }),
      },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such section", schema: problemSchema },
    },
  },
  {
    id: "academics.section-roster-attendance",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/academics/sections/{sectionId}/roster-attendance",
    summary: "Per-student attendance for a section's roster (the teacher flashcard feed)",
    description:
      "One card per student: attendance counts, percentage, and a recent-session strip — computed only over the sessions the caller may read (row-filtered by the ScopeChecker, so a subject teacher sees their own period). Pass subjectId to scope the numbers to one subject.",
    tags: ["academics-attendance"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ sectionId: idSchema }),
      query: z.object({
        academicYear: academicYearSchema.optional(),
        subjectId: idSchema.optional(),
      }),
    },
    responses: {
      200: {
        description: "A card per student who has any visible attendance",
        schema: z.object({
          cards: z.array(
            z.object({
              studentId: z.string(),
              counts: z.object({
                present: z.number(),
                absent: z.number(),
                late: z.number(),
                excused: z.number(),
              }),
              attended: z.number(),
              total: z.number(),
              pct: z.number().nullable(),
              recent: z.array(z.object({ heldOn: z.string(), status: attendanceStatusSchema })),
            }),
          ),
        }),
      },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such section", schema: problemSchema },
    },
  },
  {
    id: "academics.student-attendance",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/academics/students/{studentId}/attendance",
    summary: "A student's attendance record (rows the caller's scope covers)",
    description:
      "Row-filtered by the ScopeChecker: each session is checked at its own stored org path; counts are computed over granted rows only.",
    tags: ["academics-attendance"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ studentId: idSchema }),
      query: z.object({ academicYear: academicYearSchema.optional() }),
    },
    responses: {
      200: {
        description: "Granted sessions + counts",
        schema: z.object({
          sessions: z.array(
            z.object({
              sessionId: z.string(),
              sectionId: z.string(),
              heldOn: z.string(),
              slot: z.string(),
              status: attendanceStatusSchema,
            }),
          ),
          counts: z.object({
            present: z.number(),
            absent: z.number(),
            late: z.number(),
            excused: z.number(),
          }),
        }),
      },
      404: { description: "No such student", schema: problemSchema },
    },
  },
  {
    id: "academics.assessment-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/academics/assessments",
    summary: "Create an assessment (the subject's teacher)",
    description:
      "Marks are SUBJECT records: creation requires the caller's teacher grant for exactly this class + subject. The subject must belong to the class's department.",
    tags: ["academics-marks"],
    auth: TEACHER_ONLY,
    request: {
      body: z.object({
        classId: idSchema,
        subjectId: idSchema,
        kind: assessmentKindSchema,
        name: z.string().trim().min(1).max(128),
        academicYear: academicYearSchema,
        maxScore: scoreSchema.refine((value) => value > 0, "maxScore must be positive"),
        heldOn: dateSchema.optional(),
      }),
    },
    audit: { action: "academics.assessment-created", resourceType: "assessment" },
    responses: {
      201: { description: "Created", schema: assessmentViewSchema },
      404: { description: "No such class or subject", schema: problemSchema },
      409: { description: "Duplicate assessment name for this class/subject/year", schema: problemSchema },
      422: { description: "Subject does not belong to the class's department", schema: problemSchema },
    },
  },
  {
    id: "academics.assessment-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/academics/assessments/{assessmentId}",
    summary: "Delete an assessment without marks (the subject's teacher)",
    tags: ["academics-marks"],
    auth: TEACHER_ONLY,
    request: { params: z.object({ assessmentId: idSchema }) },
    audit: { action: "academics.assessment-deleted", resourceType: "assessment" },
    responses: {
      200: { description: "Deleted", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such assessment", schema: problemSchema },
      409: { description: "Marks exist — deletion blocked", schema: problemSchema },
    },
  },
  {
    id: "academics.class-assessments",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/academics/classes/{classId}/assessments",
    summary: "A class's assessments the caller may see (row-filtered by subject scope)",
    tags: ["academics-marks"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ classId: idSchema }),
      query: z.object({ academicYear: academicYearSchema.optional() }),
    },
    responses: {
      200: { description: "Granted assessments", schema: z.object({ assessments: z.array(assessmentViewSchema) }) },
      404: { description: "No such class", schema: problemSchema },
    },
  },
  {
    id: "academics.assessment-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/academics/assessments/{assessmentId}",
    summary: "One assessment",
    tags: ["academics-marks"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ assessmentId: idSchema }) },
    responses: {
      200: { description: "The assessment", schema: assessmentViewSchema },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such assessment", schema: problemSchema },
    },
  },
  {
    id: "academics.marks-enter",
    module: MODULE_NAME,
    method: "PUT",
    path: "/api/v1/academics/assessments/{assessmentId}/marks",
    summary: "Enter or update a marksheet in bulk (the subject's teacher)",
    description:
      "All-or-nothing: every entry is validated (score within maxScore, student enrolled in the class) before any write; the audit event carries per-entry before/after diffs (grade-change integrity).",
    tags: ["academics-marks"],
    auth: TEACHER_ONLY,
    request: {
      params: z.object({ assessmentId: idSchema }),
      body: z.object({
        entries: z.array(z.object({ studentId: idSchema, score: scoreSchema })).min(1).max(500),
      }),
    },
    audit: { action: "academics.marks-entered", resourceType: "assessment" },
    responses: {
      200: {
        description: "Marksheet applied",
        schema: z.object({ created: z.number(), updated: z.number(), unchanged: z.number() }),
      },
      404: { description: "No such assessment", schema: problemSchema },
      422: { description: "Invalid entries (score range / not enrolled in this class)", schema: invalidEntriesSchema },
    },
  },
  {
    id: "academics.mark-correct",
    module: MODULE_NAME,
    method: "PATCH",
    path: "/api/v1/academics/marks/{markId}",
    summary: "Correct one mark (the subject's teacher; audited with before/after)",
    tags: ["academics-marks"],
    auth: TEACHER_ONLY,
    request: {
      params: z.object({ markId: idSchema }),
      body: z.object({ score: scoreSchema }),
    },
    audit: { action: "academics.mark-corrected", resourceType: "mark" },
    responses: {
      200: { description: "Corrected", schema: markViewSchema },
      404: { description: "No such mark", schema: problemSchema },
      422: { description: "Score exceeds the assessment's maxScore", schema: problemSchema },
    },
  },
  {
    id: "academics.assessment-marks",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/academics/assessments/{assessmentId}/marks",
    summary: "An assessment's marks",
    tags: ["academics-marks"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ assessmentId: idSchema }) },
    responses: {
      200: { description: "Marks", schema: z.object({ marks: z.array(markViewSchema) }) },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such assessment", schema: problemSchema },
    },
  },
  {
    id: "academics.student-marks",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/academics/students/{studentId}/marks",
    summary: "A student's marks the caller may see (row-filtered by subject scope)",
    description:
      "Each mark is checked at its assessment's stored class path + subjectId — a subject teacher sees only their own subject's rows.",
    tags: ["academics-marks"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ studentId: idSchema }),
      query: z.object({
        academicYear: academicYearSchema.optional(),
        subjectId: idSchema.optional(),
      }),
    },
    responses: {
      200: {
        description: "Granted marks with their assessments",
        schema: z.object({
          marks: z.array(
            z.object({
              mark: markViewSchema,
              assessment: assessmentViewSchema,
            }),
          ),
        }),
      },
      404: { description: "No such student", schema: problemSchema },
    },
  },
  {
    id: "academics.mark-history",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/academics/marks/{markId}/history",
    summary: "A mark's complete change history (from the append-only audit log)",
    tags: ["academics-marks"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ markId: idSchema }) },
    responses: {
      200: {
        description: "Audit events, newest first",
        schema: z.object({
          history: z.array(
            z.object({
              action: z.string(),
              actorId: z.string().nullable(),
              occurredAt: z.string(),
              details: z.record(z.string(), z.unknown()),
            }),
          ),
        }),
      },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such mark", schema: problemSchema },
    },
  },
];

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const GAP_SCAN_JOB_NAME = "attendance-gap-scan";
export const GAP_SCAN_SCHEDULER_ID = "academics-attendance-gap-scan";
export const gapScanPayloadSchema = z.object({
  /** ISO date to scan; defaults to the worker's current date. */
  date: dateSchema.optional(),
  source: z.string().min(1),
});

const jobs: JobSpec[] = [
  {
    name: GAP_SCAN_JOB_NAME,
    module: MODULE_NAME,
    summary:
      "Daily college-wide scan: sections with live enrollment but no attendance session for the day; reports (audited) so the office can chase gaps.",
    payloadSchema: gapScanPayloadSchema,
  },
];

export const academicsModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs,
};
