/**
 * summarizeAttendance — the pure entry point of the S02 attendance-summary
 * engine. No database access, HTTP, authorization, logging, current-time
 * dependency, or global mutable state; every input is validated and the
 * function always returns an `AttendanceSummaryOutcome`, never throws for
 * bad input. Inputs are never mutated.
 */
import { compareIsoDates, enumerateIsoDates, isValidIsoDate } from "./dates";
import {
  ENGINE_VERSION,
  POLICY_VERSION,
  type AttendancePolicy,
  type AttendanceRecord,
  type AttendanceSummaryFailureCode,
  type AttendanceSummaryIssue,
  type AttendanceSummaryOutcome,
  type AttendanceSummaryRequest,
  type AttendanceSummaryResult,
  type DateInterval,
  type EnrollmentInterval,
  type RecordedAttendanceStatus,
  type SchoolCalendar,
} from "./contract";

const VALID_STATUSES: ReadonlySet<string> = new Set(["present", "absent", "late", "excused", "half-day"]);
const VALID_LATE: ReadonlySet<string> = new Set(["counts-as-present", "counts-as-absent"]);
const VALID_EXCUSED: ReadonlySet<string> = new Set(["excluded-from-denominator", "counts-as-absent"]);
const VALID_HALF_DAY: ReadonlySet<string> = new Set(["half-credit", "counts-as-present", "counts-as-absent"]);

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * F5 correction: validates the request's SHAPE — every container the code
 * below iterates is actually an array, and every element it dereferences is
 * a non-null object — before any typed check reads a property or iterates.
 * `AttendanceSummaryRequest` only binds compile-time callers; a caller
 * passing deserialized/untrusted data can still hand this function `null`
 * anywhere in the tree (a null request, a null policy, a null interval, a
 * null calendar, a null element inside enrollments/records, or a records
 * container that isn't an array at all), which throws immediately on
 * property access or iteration rather than producing the documented
 * `AttendanceSummaryOutcome` failure. This function treats its input as
 * effectively `unknown` regardless of the declared parameter type, and is
 * the only place in this file that does so — every function below it can
 * keep assuming its typed shape actually holds, because this ran first.
 *
 * This only screens for shapes that would THROW (null/undefined containers
 * or elements, non-arrays where an array is iterated). A present-but-wrong
 * primitive (e.g. a numeric status, a non-string date) does not throw on
 * property access in JavaScript — those are left to the existing semantic
 * checks below (and to `isValidIsoDate`, which itself now rejects any
 * non-string value before parsing), which already reject them without
 * crashing.
 */
function checkRequestShape(request: unknown): { code: AttendanceSummaryFailureCode; issues: AttendanceSummaryIssue[] } | null {
  if (isNullish(request) || typeof request !== "object") {
    return { code: "invalid-policy", issues: [{ message: "The attendance summary request must be an object." }] };
  }
  const { policy, interval, calendar, enrollments, records } = request as Record<string, unknown>;

  if (isNullish(policy) || typeof policy !== "object") {
    return { code: "invalid-policy", issues: [{ message: "policy must be an object." }] };
  }
  if (isNullish(interval) || typeof interval !== "object") {
    return { code: "invalid-interval", issues: [{ message: "interval must be an object." }] };
  }
  if (isNullish(calendar) || typeof calendar !== "object") {
    return { code: "invalid-calendar", issues: [{ message: "calendar must be an object." }] };
  }
  if (Array.isArray(enrollments) && enrollments.some((enrollment) => isNullish(enrollment) || typeof enrollment !== "object")) {
    return { code: "invalid-enrollment", issues: [{ message: "Each enrollment interval must be an object." }] };
  }
  if (!Array.isArray(records)) {
    return { code: "invalid-record", issues: [{ message: "records must be an array." }] };
  }
  if (records.some((record) => isNullish(record) || typeof record !== "object")) {
    return { code: "invalid-record", issues: [{ message: "Each attendance record must be an object." }] };
  }

  return null;
}

function checkPolicy(policy: AttendancePolicy): AttendanceSummaryIssue[] {
  const issues: AttendanceSummaryIssue[] = [];
  if (policy.version !== POLICY_VERSION) {
    issues.push({ message: `Unsupported attendance policy version "${String(policy.version)}"; this engine implements "${POLICY_VERSION}".` });
  }
  if (!VALID_LATE.has(policy.lateTreatment)) issues.push({ message: `Unknown lateTreatment "${String(policy.lateTreatment)}".` });
  if (!VALID_EXCUSED.has(policy.excusedTreatment)) issues.push({ message: `Unknown excusedTreatment "${String(policy.excusedTreatment)}".` });
  if (!VALID_HALF_DAY.has(policy.halfDayTreatment)) issues.push({ message: `Unknown halfDayTreatment "${String(policy.halfDayTreatment)}".` });
  return issues;
}

function checkInterval(interval: DateInterval): AttendanceSummaryIssue[] {
  const issues: AttendanceSummaryIssue[] = [];
  if (!isValidIsoDate(interval.from)) issues.push({ message: `Interval "from" is not a valid calendar date: "${interval.from}".`, date: interval.from });
  if (!isValidIsoDate(interval.to)) issues.push({ message: `Interval "to" is not a valid calendar date: "${interval.to}".`, date: interval.to });
  if (issues.length === 0 && compareIsoDates(interval.from, interval.to) > 0) {
    issues.push({ message: `Interval "from" (${interval.from}) must not be after "to" (${interval.to}).` });
  }
  return issues;
}

function checkCalendar(calendar: SchoolCalendar): AttendanceSummaryIssue[] {
  const issues: AttendanceSummaryIssue[] = [];
  if (!Array.isArray(calendar.instructionalDays)) {
    return [{ message: "instructionalDays must be an array of calendar dates." }];
  }
  for (const date of calendar.instructionalDays) {
    if (!isValidIsoDate(date)) issues.push({ message: `Calendar contains an invalid date: "${date}".`, date });
  }
  return issues;
}

function checkEnrollments(enrollments: readonly EnrollmentInterval[]): AttendanceSummaryIssue[] {
  const issues: AttendanceSummaryIssue[] = [];
  if (!Array.isArray(enrollments) || enrollments.length === 0) {
    return [{ message: "At least one enrollment interval is required." }];
  }
  const valid: { from: string; to: string | null }[] = [];
  for (const enrollment of enrollments) {
    if (!isValidIsoDate(enrollment.from)) {
      issues.push({ message: `Enrollment "from" is not a valid calendar date: "${enrollment.from}".`, date: enrollment.from });
      continue;
    }
    if (enrollment.to !== null && !isValidIsoDate(enrollment.to)) {
      issues.push({ message: `Enrollment "to" is not a valid calendar date: "${enrollment.to}".`, date: enrollment.to });
      continue;
    }
    if (enrollment.to !== null && compareIsoDates(enrollment.from, enrollment.to) > 0) {
      issues.push({ message: `Enrollment "from" (${enrollment.from}) must not be after "to" (${enrollment.to}).` });
      continue;
    }
    valid.push({ from: enrollment.from, to: enrollment.to });
  }
  if (issues.length > 0) return issues;

  const sorted = [...valid].sort((a, b) => compareIsoDates(a.from, b.from));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (previous.to === null || compareIsoDates(previous.to, current.from) >= 0) {
      issues.push({ message: `Enrollment interval starting ${current.from} overlaps another enrollment interval.`, date: current.from });
    }
  }
  return issues;
}

function checkRecords(records: readonly AttendanceRecord[]): AttendanceSummaryIssue[] {
  if (!Array.isArray(records)) {
    return [{ message: "records must be an array." }];
  }
  const issues: AttendanceSummaryIssue[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!isValidIsoDate(record.date)) {
      issues.push({ message: `Record date is not a valid calendar date: "${record.date}".`, date: record.date });
      continue;
    }
    if (!VALID_STATUSES.has(record.status)) {
      issues.push({ message: `Record for ${record.date} has an unrecognized status "${String(record.status)}".`, date: record.date });
      continue;
    }
    if (seen.has(record.date)) {
      issues.push({ message: `Duplicate or conflicting attendance record for ${record.date}.`, date: record.date });
      continue;
    }
    seen.add(record.date);
  }
  return issues;
}

function isEnrolledOn(date: string, enrollments: readonly EnrollmentInterval[]): boolean {
  return enrollments.some((enrollment) => compareIsoDates(date, enrollment.from) >= 0 && (enrollment.to === null || compareIsoDates(date, enrollment.to) <= 0));
}

function emptyStatusTotals(): Record<RecordedAttendanceStatus, number> {
  return { present: 0, absent: 0, late: 0, excused: 0, "half-day": 0 };
}

/** Present-equivalent contribution of one record, in half-day units (an
 * integer: 0, 1, or 2) so the final percentage can be computed with exact
 * integer division instead of accumulating float error. */
function halfUnitsFor(status: RecordedAttendanceStatus, policy: AttendancePolicy): number {
  switch (status) {
    case "present":
      return 2;
    case "absent":
    case "excused":
      return 0;
    case "late":
      return policy.lateTreatment === "counts-as-present" ? 2 : 0;
    case "half-day":
      return policy.halfDayTreatment === "counts-as-present" ? 2 : policy.halfDayTreatment === "half-credit" ? 1 : 0;
  }
}

/** Exact half-up rounding of (numerator/denominator)*100 to 2dp, using
 * BigInt so no floating-point division ever runs on the final ratio. */
function percentageOf(halfUnits: number, denominatorDays: number): number {
  const numerator = BigInt(halfUnits) * 5000n; // halfUnits/(2*denominatorDays)*100*100
  const denominator = BigInt(denominatorDays);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return Number(rounded) / 100;
}

export function summarizeAttendance(request: AttendanceSummaryRequest): AttendanceSummaryOutcome {
  const shapeProblem = checkRequestShape(request);
  if (shapeProblem) return { ok: false, code: shapeProblem.code, issues: shapeProblem.issues };

  const policyIssues = checkPolicy(request.policy);
  if (policyIssues.length > 0) return { ok: false, code: "invalid-policy", issues: policyIssues };

  const intervalIssues = checkInterval(request.interval);
  if (intervalIssues.length > 0) return { ok: false, code: "invalid-interval", issues: intervalIssues };

  const calendarIssues = checkCalendar(request.calendar);
  if (calendarIssues.length > 0) return { ok: false, code: "invalid-calendar", issues: calendarIssues };

  const enrollmentIssues = checkEnrollments(request.enrollments);
  if (enrollmentIssues.length > 0) return { ok: false, code: "invalid-enrollment", issues: enrollmentIssues };

  const recordIssues = checkRecords(request.records);
  if (recordIssues.length > 0) return { ok: false, code: "invalid-record", issues: recordIssues };

  const instructionalDays = new Set(request.calendar.instructionalDays);
  const allDates = enumerateIsoDates(request.interval.from, request.interval.to);
  const expectedDates = allDates.filter((date) => instructionalDays.has(date) && isEnrolledOn(date, request.enrollments));
  const expectedSet = new Set(expectedDates);

  const recordByDate = new Map(request.records.map((record) => [record.date, record.status]));
  const ignoredRecords: { date: string; reason: string }[] = [];
  const statusTotals = emptyStatusTotals();
  let halfUnits = 0;
  let excusedCount = 0;

  for (const record of request.records) {
    if (!expectedSet.has(record.date)) {
      const reason = compareIsoDates(record.date, request.interval.from) < 0 || compareIsoDates(record.date, request.interval.to) > 0
        ? "outside the requested interval"
        : !instructionalDays.has(record.date)
          ? "non-instructional day"
          : "outside enrollment";
      ignoredRecords.push({ date: record.date, reason });
      continue;
    }
    statusTotals[record.status] += 1;
    halfUnits += halfUnitsFor(record.status, request.policy);
    if (record.status === "excused") excusedCount += 1;
  }

  const missingDates = expectedDates.filter((date) => !recordByDate.has(date));
  const complete = missingDates.length === 0;
  const percentageDenominator = expectedDates.length - (request.policy.excusedTreatment === "excluded-from-denominator" ? excusedCount : 0);

  const percentageUnavailableReason = percentageDenominator === 0 ? "zero-denominator" : !complete ? "incomplete" : null;

  const result: AttendanceSummaryResult = {
    policyVersion: request.policy.version,
    calculationVersion: ENGINE_VERSION,
    interval: request.interval,
    expectedDays: expectedDates.length,
    recordedDays: expectedDates.length - missingDates.length,
    missingDays: missingDates.length,
    missingDates,
    complete,
    statusTotals,
    percentageDenominator,
    presentEquivalentDays: percentageUnavailableReason === null ? halfUnits / 2 : null,
    percentage: percentageUnavailableReason === null ? percentageOf(halfUnits, percentageDenominator) : null,
    percentageUnavailableReason,
    ignoredRecords,
  };
  return { ok: true, result };
}
