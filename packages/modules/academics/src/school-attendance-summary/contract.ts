/**
 * School attendance-summary calculation contract (S02).
 *
 * A pure, versioned summary of one student's attendance over a date
 * interval, from an explicit resolved calendar, enrollment intervals, and
 * attendance records. This is the calculation foundation only: no
 * database access, HTTP, API wiring, or shortfall/threshold decision is
 * made here (see this directory's S02 delivery notes for scope).
 *
 * Unlike S01 (`school-academics/aggregation`), incomplete attendance data
 * does NOT block the whole result: a principal needs to see "18 of 20 days
 * recorded, 2 still missing" as it stands, not nothing at all (5.4's
 * acceptance: "a principal can see missing submissions separately from
 * pupil absence"). Instead, completeness is reported explicitly
 * (`complete`, `missingDates`) and the derived percentage is `null` — never
 * a number computed as if the missing days did not exist — whenever the
 * data is incomplete or the percentage's denominator is zero. Only
 * malformed/inconsistent INPUT (bad dates, overlapping enrollment,
 * duplicate records, an unrecognized policy) is rejected outright.
 *
 * Versioning mirrors S01: `POLICY_VERSION` is the policy shape this engine
 * accepts; `ENGINE_VERSION` is the arithmetic that produced a result.
 */

export const POLICY_VERSION = "school-attendance-summary.policy.v1" as const;
export const ENGINE_VERSION = "school-attendance-summary.engine.v1" as const;

export type RecordedAttendanceStatus = "present" | "absent" | "late" | "excused" | "half-day";

/** How a "late" record counts toward the present-equivalent numerator. */
export type LateTreatment = "counts-as-present" | "counts-as-absent";

/** How an "excused" (approved leave) record counts. "excluded-from-denominator"
 * removes the day from both the numerator and the percentage's denominator
 * (the day is not held against the student at all); "counts-as-absent"
 * keeps it in the denominator without numerator credit. Neither option
 * changes `expectedDays`, which is always the raw calendar/enrollment
 * figure — see `percentageDenominator` on the result for the post-exclusion
 * figure actually used in `percentage`. */
export type ExcusedTreatment = "excluded-from-denominator" | "counts-as-absent";

/** How a "half-day" (partial-day) record counts. */
export type HalfDayTreatment = "half-credit" | "counts-as-present" | "counts-as-absent";

export interface AttendancePolicy {
  readonly version: typeof POLICY_VERSION;
  readonly lateTreatment: LateTreatment;
  readonly excusedTreatment: ExcusedTreatment;
  readonly halfDayTreatment: HalfDayTreatment;
}

/** The reporting window. Both bounds are inclusive calendar dates. */
export interface DateInterval {
  readonly from: string;
  readonly to: string;
}

/** The resolved set of instructional dates for the school (weekends,
 * vacations and holidays already excluded by whoever built this list — this
 * engine never derives a day-of-week or holiday on its own). A date absent
 * from this list is non-instructional and never counted as expected. */
export interface SchoolCalendar {
  readonly instructionalDays: readonly string[];
}

/** One span during which the student was enrolled. `to: null` means still
 * enrolled at least through the request's `interval.to`. Multiple intervals
 * may describe a student who left and later rejoined; they must not
 * overlap. */
export interface EnrollmentInterval {
  readonly from: string;
  readonly to: string | null;
}

export interface AttendanceRecord {
  readonly date: string;
  readonly status: RecordedAttendanceStatus;
}

export interface AttendanceSummaryRequest {
  readonly policy: AttendancePolicy;
  readonly interval: DateInterval;
  readonly calendar: SchoolCalendar;
  readonly enrollments: readonly EnrollmentInterval[];
  readonly records: readonly AttendanceRecord[];
}

/** Why `percentage`/`presentEquivalentDays` is null even though the request
 * itself was valid. */
export type PercentageUnavailableReason = "incomplete" | "zero-denominator";

export interface AttendanceSummaryResult {
  readonly policyVersion: string;
  readonly calculationVersion: string;
  readonly interval: DateInterval;

  /** Instructional days within the interval AND at least one enrollment
   * interval — the raw denominator before any policy exclusion. */
  readonly expectedDays: number;
  /** Expected days that have exactly one attendance record. */
  readonly recordedDays: number;
  /** expectedDays - recordedDays, as a count and the explicit date list. */
  readonly missingDays: number;
  readonly missingDates: readonly string[];
  /** True iff every expected day has a record (missingDays === 0). */
  readonly complete: boolean;

  /** Recorded-day counts by status; keys always present (0 when unused). */
  readonly statusTotals: Readonly<Record<RecordedAttendanceStatus, number>>;

  /** expectedDays minus excused days when `excusedTreatment` is
   * "excluded-from-denominator" — the figure `percentage` is actually
   * computed against. Equal to `expectedDays` otherwise. */
  readonly percentageDenominator: number;
  /** Present-equivalent day count under the policy (0.5 per half-credited
   * half-day). Null exactly when `percentage` is null. */
  readonly presentEquivalentDays: number | null;
  /** Rounded to 2dp, half-up. Null when incomplete or when
   * `percentageDenominator` is 0 — see `percentageUnavailableReason`. */
  readonly percentage: number | null;
  readonly percentageUnavailableReason: PercentageUnavailableReason | null;

  /** Records that fell outside every expected day (before enrollment, after
   * departure, on a non-instructional day, or outside the interval) — kept
   * visible rather than silently dropped. */
  readonly ignoredRecords: readonly { readonly date: string; readonly reason: string }[];
}

export type AttendanceSummaryFailureCode = "invalid-policy" | "invalid-interval" | "invalid-calendar" | "invalid-enrollment" | "invalid-record";

export interface AttendanceSummaryIssue {
  readonly message: string;
  readonly date?: string;
}

export type AttendanceSummaryOutcome =
  | { readonly ok: true; readonly result: AttendanceSummaryResult }
  | { readonly ok: false; readonly code: AttendanceSummaryFailureCode; readonly issues: readonly AttendanceSummaryIssue[] };
