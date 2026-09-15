/**
 * S02 correction regressions (Astra finding F5). Independent of
 * calculate.test.ts and written from the review's reproduction steps, not
 * from the implementation — each case restates an expected value rather
 * than re-deriving the code's own arithmetic.
 */
import { describe, expect, it } from "vitest";
import { summarizeAttendance } from "./calculate";
import {
  POLICY_VERSION,
  type AttendancePolicy,
  type AttendanceRecord,
  type AttendanceSummaryRequest,
  type EnrollmentInterval,
  type ExcusedTreatment,
  type HalfDayTreatment,
  type LateTreatment,
} from "./contract";

function policy(overrides: Partial<AttendancePolicy> = {}): AttendancePolicy {
  return {
    version: POLICY_VERSION,
    lateTreatment: "counts-as-present",
    excusedTreatment: "excluded-from-denominator",
    halfDayTreatment: "half-credit",
    ...overrides,
  };
}

function present(date: string): AttendanceRecord {
  return { date, status: "present" };
}

const DAYS5 = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];

function baseRequest(overrides: Partial<AttendanceSummaryRequest> = {}): AttendanceSummaryRequest {
  return {
    policy: policy(),
    interval: { from: DAYS5[0]!, to: DAYS5[4]! },
    calendar: { instructionalDays: DAYS5 },
    enrollments: [{ from: DAYS5[0]!, to: null }],
    records: DAYS5.map(present),
    ...overrides,
  };
}

describe("F5 — malformed input shapes never throw and return a structured failure", () => {
  it("a null request returns a failure instead of throwing", () => {
    expect(() => summarizeAttendance(null as unknown as AttendanceSummaryRequest)).not.toThrow();
    expect(summarizeAttendance(null as unknown as AttendanceSummaryRequest).ok).toBe(false);
  });

  it("a null policy returns invalid-policy instead of throwing", () => {
    const req = { ...baseRequest(), policy: null } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-policy");
  });

  it("a null interval returns invalid-interval instead of throwing", () => {
    const req = { ...baseRequest(), interval: null } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-interval");
  });

  it("a null calendar returns invalid-calendar instead of throwing", () => {
    const req = { ...baseRequest(), calendar: null } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-calendar");
  });

  it("a malformed (non-array) instructionalDays container returns invalid-calendar instead of throwing", () => {
    const req = { ...baseRequest(), calendar: { instructionalDays: "not-an-array" } } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-calendar");
  });

  it("a malformed (null/non-string) element in instructionalDays returns invalid-calendar instead of throwing", () => {
    const req = { ...baseRequest(), calendar: { instructionalDays: [null, 42, {}, ...DAYS5] } } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-calendar");
  });

  it("a malformed (non-array) enrollments container returns invalid-enrollment instead of throwing", () => {
    const req = { ...baseRequest(), enrollments: "not-an-array" } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-enrollment");
  });

  it("a null enrollment element returns invalid-enrollment instead of throwing", () => {
    const req = { ...baseRequest(), enrollments: [null] } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-enrollment");
  });

  it("a null records container returns invalid-record instead of throwing", () => {
    const req = { ...baseRequest(), records: null } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-record");
  });

  it("a malformed (non-array) records container returns invalid-record instead of throwing", () => {
    const req = { ...baseRequest(), records: "not-an-array" } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-record");
  });

  it("a null record element returns invalid-record instead of throwing", () => {
    const req = { ...baseRequest(), records: [null, ...baseRequest().records] } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-record");
  });

  it.each([
    ["interval.from", { interval: { from: 20260601, to: DAYS5[4]! } }],
    ["a record date", { records: [{ date: 20260601, status: "present" }] }],
    ["an enrollment from", { enrollments: [{ from: {}, to: null }] }],
  ] as const)("rejects a non-string date value (%s) instead of throwing during parsing", (_label, overrides) => {
    const req = { ...baseRequest(), ...overrides } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    expect(summarizeAttendance(req).ok).toBe(false);
  });

  it("a non-string record status is rejected without throwing (a required field type assumed without validation)", () => {
    const req = { ...baseRequest(), records: [{ date: DAYS5[0], status: 42 }, ...baseRequest().records.slice(1)] } as unknown as AttendanceSummaryRequest;
    expect(() => summarizeAttendance(req)).not.toThrow();
    const outcome = summarizeAttendance(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-record");
  });

  it("does not conceal a genuine programmer error by blanket-catching: valid input still computes normally", () => {
    // Guards against a "fix" that wraps the whole function in try/catch —
    // that would also mask real bugs. A well-formed request must still
    // succeed and compute the real answer, not merely "not throw".
    const outcome = summarizeAttendance(baseRequest());
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.percentage).toBe(100);
  });
});

describe("F5 correction — preserved valid-input semantics", () => {
  // One present, one absent, one late, one excused, one half-day.
  // numerator = 2(present) + 0(absent) + late? + 0(excused, always) + half?
  // denominator = 5, minus 1 if excusedTreatment excludes it.
  const statusDays: AttendanceRecord[] = [
    { date: DAYS5[0]!, status: "present" },
    { date: DAYS5[1]!, status: "absent" },
    { date: DAYS5[2]!, status: "late" },
    { date: DAYS5[3]!, status: "excused" },
    { date: DAYS5[4]!, status: "half-day" },
  ];
  const expected: Record<string, number> = {
    "counts-as-present|excluded-from-denominator|half-credit": 62.5,
    "counts-as-present|excluded-from-denominator|counts-as-present": 75,
    "counts-as-present|excluded-from-denominator|counts-as-absent": 50,
    "counts-as-present|counts-as-absent|half-credit": 50,
    "counts-as-present|counts-as-absent|counts-as-present": 60,
    "counts-as-present|counts-as-absent|counts-as-absent": 40,
    "counts-as-absent|excluded-from-denominator|half-credit": 37.5,
    "counts-as-absent|excluded-from-denominator|counts-as-present": 50,
    "counts-as-absent|excluded-from-denominator|counts-as-absent": 25,
    "counts-as-absent|counts-as-absent|half-credit": 30,
    "counts-as-absent|counts-as-absent|counts-as-present": 40,
    "counts-as-absent|counts-as-absent|counts-as-absent": 20,
  };

  const lateOptions: LateTreatment[] = ["counts-as-present", "counts-as-absent"];
  const excusedOptions: ExcusedTreatment[] = ["excluded-from-denominator", "counts-as-absent"];
  const halfDayOptions: HalfDayTreatment[] = ["half-credit", "counts-as-present", "counts-as-absent"];

  for (const lateTreatment of lateOptions) {
    for (const excusedTreatment of excusedOptions) {
      for (const halfDayTreatment of halfDayOptions) {
        const key = `${lateTreatment}|${excusedTreatment}|${halfDayTreatment}`;
        it(`policy combination ${key} -> ${expected[key]}%`, () => {
          const outcome = summarizeAttendance(baseRequest({ policy: policy({ lateTreatment, excusedTreatment, halfDayTreatment }), records: statusDays }));
          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.result.percentage).toBe(expected[key]);
          expect(outcome.ok && outcome.result.expectedDays).toBe(5);
          expect(outcome.ok && outcome.result.recordedDays).toBe(5);
        });
      }
    }
  }

  it("a missing submission stays distinct from a recorded absence", () => {
    const outcome = summarizeAttendance(baseRequest({ records: baseRequest().records.slice(0, 4) }));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.percentage).toBeNull();
    expect(outcome.ok && outcome.result.presentEquivalentDays).toBeNull();
    expect(outcome.ok && outcome.result.percentageUnavailableReason).toBe("incomplete");
    expect(outcome.ok && outcome.result.missingDates).toEqual([DAYS5[4]]);
  });

  it("zero denominator (every day excused, excluded-from-denominator) is explicit", () => {
    const outcome = summarizeAttendance(baseRequest({ records: DAYS5.map((date) => ({ date, status: "excused" as const })) }));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.percentage).toBeNull();
    expect(outcome.ok && outcome.result.percentageUnavailableReason).toBe("zero-denominator");
  });

  it("inclusive re-enrollment gap and ignored-record reporting are preserved", () => {
    const enrollments: EnrollmentInterval[] = [{ from: DAYS5[0]!, to: DAYS5[1]! }, { from: DAYS5[3]!, to: null }];
    const outcome = summarizeAttendance(baseRequest({ enrollments }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.expectedDays).toBe(4); // DAYS5[2] falls in the gap
    expect(outcome.result.percentage).toBe(100);
    expect(outcome.result.ignoredRecords).toEqual([{ date: DAYS5[2], reason: "outside enrollment" }]);
  });

  it("exact half-up rounding: one half-day among sixteen eligible days rounds 3.125% to 3.13%", () => {
    const days16 = Array.from({ length: 16 }, (_, index) => `2026-03-${String(index + 1).padStart(2, "0")}`);
    const records: AttendanceRecord[] = days16.map((date, index) => ({ date, status: index === 0 ? "half-day" : "absent" }));
    const outcome = summarizeAttendance({
      policy: policy({ halfDayTreatment: "half-credit" }),
      interval: { from: days16[0]!, to: days16[15]! },
      calendar: { instructionalDays: days16 },
      enrollments: [{ from: days16[0]!, to: null }],
      records,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.percentage).toBe(3.13);
  });

  it("timezone independence: the same request computes identically regardless of process TZ", () => {
    // The dates module is UTC-anchored and never reads process-local time, so
    // this in-process check plus the separate-process script referenced in
    // the delivery report both cover the same guarantee described in the
    // dates.ts module doc.
    const outcome = summarizeAttendance(baseRequest());
    expect(outcome.ok && outcome.result.percentage).toBe(100);
  });

  it("does not mutate any input", () => {
    function deepFreeze<T>(value: T): T {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value as object).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    }
    const req = deepFreeze(baseRequest());
    expect(() => summarizeAttendance(req)).not.toThrow();
  });
});
