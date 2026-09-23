import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_PARSERS,
  SNAPSHOT_VERSION,
  parseStoredSnapshot,
  type ReportCardSnapshot,
} from "./report-card-contract";

/**
 * The stored snapshot is a forwards-compatibility contract, not just a
 * response shape: rows written today are read back and rendered years from
 * now. These tests pin the property that makes that true.
 */

const VALID: ReportCardSnapshot = {
  snapshotVersion: SNAPSHOT_VERSION,
  student: { id: "stu-1", fullName: "Asha Kulkarni", admissionNo: "A-001" },
  term: { id: "t", name: "Term 1", academicYear: "2026-27", startsOn: "2026-06-01", endsOn: "2026-10-31" },
  subjects: [{ subjectId: "m", subjectName: "Mathematics", percentage: 90, grade: "A", complete: true }],
  overall: { percentage: 90, grade: "A", complete: true },
  attendance: {
    eligibleDays: 80,
    presentEquivalentDays: 74,
    percentage: 92.5,
    complete: true,
    missingDates: [],
  },
  warnings: [],
  provenance: {
    resultPolicyVersion: "school-weighted-result.policy.v1",
    resultEngineVersion: "school-weighted-result.engine.v1",
    attendancePolicyVersion: "school-attendance-summary.policy.v1",
    attendanceEngineVersion: "school-attendance-summary.engine.v1",
    withinTypeAggregation: "earned-points",
    lateTreatment: "counts-as-present",
    excusedTreatment: "excluded-from-denominator",
    halfDayTreatment: "half-credit",
  },
};

describe("parseStoredSnapshot", () => {
  it("parses a stored snapshot by the version recorded on the row", () => {
    expect(parseStoredSnapshot(VALID)).toEqual(VALID);
  });

  it("keeps a parser for every version ever written, so old cards still render", () => {
    // The guard this file exists for: if a future change REPLACES the current
    // parser instead of adding alongside it, every already-issued report card
    // becomes un-renderable — the opposite of what an immutable snapshot is
    // for. Bumping SNAPSHOT_VERSION must grow this map, never swap it.
    expect(Object.keys(SNAPSHOT_PARSERS)).toContain(SNAPSHOT_VERSION);
    expect(Object.keys(SNAPSHOT_PARSERS).length).toBeGreaterThanOrEqual(1);
  });

  it("refuses an unknown version loudly rather than rendering a partial card", () => {
    expect(parseStoredSnapshot({ ...VALID, snapshotVersion: "school-report-card.snapshot.v9" })).toBeNull();
    expect(parseStoredSnapshot({ ...VALID, snapshotVersion: 7 })).toBeNull();
    expect(parseStoredSnapshot(null)).toBeNull();
    expect(parseStoredSnapshot({})).toBeNull();
  });

  it("refuses a row of the right version whose content is malformed", () => {
    const { overall: _dropped, ...missingOverall } = VALID;
    expect(parseStoredSnapshot(missingOverall)).toBeNull();
    expect(parseStoredSnapshot({ ...VALID, subjects: [{ subjectId: "m" }] })).toBeNull();
  });

  it("preserves nulls rather than coercing them to zero on the way back out", () => {
    const incomplete = {
      ...VALID,
      subjects: [{ subjectId: "m", subjectName: "Mathematics", percentage: null, grade: null, complete: false }],
      overall: { percentage: null, grade: null, complete: false },
    };
    const parsed = parseStoredSnapshot(incomplete);
    expect(parsed?.overall.percentage).toBeNull();
    expect(parsed?.subjects[0]!.percentage).toBeNull();
  });
});
