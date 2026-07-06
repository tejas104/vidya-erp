import type { OrgPath, Principal, ResourceRef, ScopeChecker } from "@vidya/platform";

/**
 * THE AGGREGATION-SCOPE SURFACE (ADR-0018) — one page, 100%-coverage-gated,
 * the analytics analogue of #4's resource-refs.ts.
 *
 * The load-bearing rule: an aggregate is served ONLY when the caller could
 * read every constituent record — never aggregate-then-check. The refs
 * built here are the CONSTITUENT refs generalized to the aggregate's node:
 *
 *  - attendance aggregates check exactly the ref an attendance record at
 *    that node carries (module "academics", resourceType
 *    "attendance-record", no subjectId) — every constituent shares that
 *    readability, so one check IS constituent-closure;
 *  - single-subject marks aggregates likewise carry their subjectId —
 *    one check per (node, subject) IS closure;
 *  - CROSS-SUBJECT marks aggregates are where the shortcut breaks (a
 *    class's "overall average" would otherwise read as a non-subject
 *    record a subject teacher could see, leaking other subjects by
 *    differencing): closure is checked EXPLICITLY per constituent subject
 *    — every subject in the aggregate must pass, or the aggregate is
 *    withheld with the denied subject named for the log.
 *
 * The minimum-cohort rule (unconditional, approved): any aggregate over
 * fewer than `minCohort` distinct students is withheld for EVERY role —
 * defense-in-depth that fails closed for future consumers.
 */

export function attendanceAggRef(node: OrgPath): ResourceRef {
  return {
    module: "academics",
    resourceType: "attendance-record",
    org: node,
    // NO subjectId — attendance constituents are non-subject records.
  };
}

export function marksAggRef(node: OrgPath, subjectId: string): ResourceRef {
  return {
    module: "academics",
    resourceType: "marks",
    org: node,
    subjectId,
  };
}

export function canReadAttendanceAgg(
  checker: ScopeChecker,
  principal: Principal,
  node: OrgPath,
): boolean {
  return checker.check(principal, "read", attendanceAggRef(node)).granted;
}

export function canReadMarksAgg(
  checker: ScopeChecker,
  principal: Principal,
  node: OrgPath,
  subjectId: string,
): boolean {
  return checker.check(principal, "read", marksAggRef(node, subjectId)).granted;
}

/** Constituent-closure for cross-subject aggregates: EVERY subject must pass. */
export function canReadCrossSubjectAgg(
  checker: ScopeChecker,
  principal: Principal,
  node: OrgPath,
  subjectIds: readonly string[],
): { granted: boolean; deniedSubjectId?: string } {
  if (subjectIds.length === 0) {
    // An aggregate with no constituents discloses nothing — but there is
    // also nothing to serve; callers treat this as absent data.
    return { granted: true };
  }
  for (const subjectId of subjectIds) {
    if (!canReadMarksAgg(checker, principal, node, subjectId)) {
      return { granted: false, deniedSubjectId: subjectId };
    }
  }
  return { granted: true };
}

/** The unconditional minimum-cohort floor (ADR-0018). */
export function cohortSufficient(distinctStudents: number, minCohort: number): boolean {
  return distinctStudents >= minCohort;
}
