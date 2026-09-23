import { z } from "zod";

/**
 * The school report-card snapshot payload — the frozen academic content of an
 * issued report card.
 *
 * This shape is a STORED CONTRACT, not just an API response. Rows written
 * today are read back and rendered years later, so it is versioned
 * (`snapshotVersion`) and carries the engine/policy versions that produced
 * every figure. A future engine revision changes new snapshots only; old ones
 * keep rendering exactly as issued.
 *
 * MISSING DATA IS EXPLICIT. `percentage` and `grade` are nullable and a
 * `complete` flag sits beside them. Nothing in this payload may be produced by
 * treating an unrecorded mark as zero, or by assuming an attendance or
 * promotion threshold — the report card states what is on record and no more.
 */

export const SNAPSHOT_VERSION = "school-report-card.snapshot.v1" as const;

export const reportCardSubjectSchema = z.object({
  subjectId: z.string(),
  subjectName: z.string(),
  percentage: z.number().nullable(),
  grade: z.string().nullable(),
  complete: z.boolean(),
});

export const reportCardAttendanceSchema = z.object({
  /** The denominator the percentage was actually computed against, after any
   *  policy exclusion (S02's `percentageDenominator`). */
  eligibleDays: z.number(),
  presentEquivalentDays: z.number().nullable(),
  percentage: z.number().nullable(),
  complete: z.boolean(),
  /** Instructional days with no record for this pupil — a register that was
   *  never completed, which is not the same as an absence. */
  missingDates: z.array(z.string()),
});

export const reportCardPreviewSchema = z.object({
  student: z.object({ id: z.string(), fullName: z.string(), admissionNo: z.string() }),
  term: z.object({
    id: z.string(),
    name: z.string(),
    academicYear: z.string(),
    startsOn: z.string(),
    endsOn: z.string(),
  }),
  subjects: z.array(reportCardSubjectSchema),
  overall: z.object({
    percentage: z.number().nullable(),
    grade: z.string().nullable(),
    complete: z.boolean(),
  }),
  attendance: reportCardAttendanceSchema,
  /** Human-readable reasons this card needs review before it is issued. */
  warnings: z.array(z.string()),
});

export type ReportCardPreview = z.infer<typeof reportCardPreviewSchema>;

/** What is persisted: the preview plus the provenance needed to defend it. */
export const reportCardSnapshotSchema = reportCardPreviewSchema.extend({
  snapshotVersion: z.literal(SNAPSHOT_VERSION),
  provenance: z.object({
    resultPolicyVersion: z.string(),
    resultEngineVersion: z.string(),
    attendancePolicyVersion: z.string(),
    attendanceEngineVersion: z.string(),
    /** The within-type aggregation and attendance treatments in force when
     *  this card was issued, recorded so a later default change cannot make an
     *  old card ambiguous. */
    withinTypeAggregation: z.string(),
    lateTreatment: z.string(),
    excusedTreatment: z.string(),
    halfDayTreatment: z.string(),
  }),
});

export type ReportCardSnapshot = z.infer<typeof reportCardSnapshotSchema>;

/**
 * Parsers for EVERY snapshot version ever written, keyed by the version
 * string stored on the row.
 *
 * A new version ADDS an entry here; it never replaces one. Validating a
 * stored row against only the current version would make bumping the version
 * silently un-renderable every report card already issued — which is exactly
 * the promise this table exists to keep. An unknown version is a loud failure
 * (the download answers 409) rather than a half-populated document.
 */
export const SNAPSHOT_PARSERS: Readonly<Record<string, z.ZodType<ReportCardSnapshot>>> = {
  [SNAPSHOT_VERSION]: reportCardSnapshotSchema,
};

/** The stored payload parsed by its own recorded version, or null if that
 *  version is not one this build knows how to render. */
export function parseStoredSnapshot(payload: unknown): ReportCardSnapshot | null {
  const version = (payload as { snapshotVersion?: unknown } | null)?.snapshotVersion;
  if (typeof version !== "string") return null;
  const parser = SNAPSHOT_PARSERS[version];
  if (parser === undefined) return null;
  const parsed = parser.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export const rosterStudentSchema = z.object({
  studentId: z.string(),
  fullName: z.string(),
  admissionNo: z.string(),
  /** The most recent snapshot for this student and term, or null. */
  snapshotId: z.string().nullable(),
  generatedAt: z.string().nullable(),
});

export type RosterStudent = z.infer<typeof rosterStudentSchema>;
