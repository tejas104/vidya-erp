import { describe, expect, it } from "vitest";
import { summarizeAttendance } from "./calculate";
import {
  POLICY_VERSION,
  type AttendancePolicy,
  type AttendanceRecord,
  type AttendanceSummaryRequest,
  type EnrollmentInterval,
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

/** A plain 5-weekday week, all instructional, one open-ended enrollment
 * covering the whole interval — the shared happy-path fixture. */
function baseRequest(overrides: Partial<AttendanceSummaryRequest> = {}): AttendanceSummaryRequest {
  const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];
  return {
    policy: policy(),
    interval: { from: days[0]!, to: days[days.length - 1]! },
    calendar: { instructionalDays: days },
    enrollments: [{ from: days[0]!, to: null }],
    records: days.map(present),
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("summarizeAttendance — golden path", () => {
  it("every expected day present -> 100%, complete", () => {
    const outcome = summarizeAttendance(baseRequest());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.expectedDays).toBe(5);
    expect(outcome.result.recordedDays).toBe(5);
    expect(outcome.result.missingDays).toBe(0);
    expect(outcome.result.complete).toBe(true);
    expect(outcome.result.percentage).toBe(100);
    expect(outcome.result.percentageUnavailableReason).toBeNull();
    expect(outcome.result.statusTotals).toEqual({ present: 5, absent: 0, late: 0, excused: 0, "half-day": 0 });
    expect(outcome.result.policyVersion).toBe(POLICY_VERSION);
    expect(outcome.result.calculationVersion).toMatch(/engine/);
  });

  it("a single-day interval (from === to) is valid", () => {
    const outcome = summarizeAttendance(
      baseRequest({ interval: { from: "2026-06-01", to: "2026-06-01" }, records: [present("2026-06-01")] }),
    );
    expect(outcome.ok && outcome.result.expectedDays).toBe(1);
    expect(outcome.ok && outcome.result.percentage).toBe(100);
  });
});

describe("summarizeAttendance — enrollment boundaries", () => {
  it("admission mid-term excludes days before admission from the denominator", () => {
    const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10"];
    const outcome = summarizeAttendance({
      policy: policy(),
      interval: { from: days[0]!, to: days[9]! },
      calendar: { instructionalDays: days },
      enrollments: [{ from: "2026-06-05", to: null }],
      records: [{ date: "2026-06-02", status: "absent" }, ...days.slice(4).map(present)],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.expectedDays).toBe(6); // June 5-10
    expect(outcome.result.complete).toBe(true);
    expect(outcome.result.percentage).toBe(100);
    // The pre-admission record must not silently vanish or count against the student.
    expect(outcome.result.ignoredRecords).toEqual([{ date: "2026-06-02", reason: "outside enrollment" }]);
    expect(outcome.result.statusTotals.absent).toBe(0);
  });

  it("departure before term end excludes days after departure, and a late stray record is ignored", () => {
    const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10"];
    const outcome = summarizeAttendance({
      policy: policy(),
      interval: { from: days[0]!, to: days[9]! },
      calendar: { instructionalDays: days },
      enrollments: [{ from: days[0]!, to: "2026-06-07" }],
      records: [...days.slice(0, 7).map(present), { date: "2026-06-09", status: "present" }],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.expectedDays).toBe(7);
    expect(outcome.result.percentage).toBe(100);
    expect(outcome.result.ignoredRecords).toEqual([{ date: "2026-06-09", reason: "outside enrollment" }]);
  });

  it("re-enrollment across two non-overlapping intervals is accepted", () => {
    const enrollments: EnrollmentInterval[] = [
      { from: "2026-06-01", to: "2026-06-02" },
      { from: "2026-06-04", to: null },
    ];
    const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];
    const outcome = summarizeAttendance(baseRequest({ enrollments, calendar: { instructionalDays: days }, interval: { from: days[0]!, to: days[4]! } }));
    expect(outcome.ok).toBe(true);
    // 2026-06-03 falls in the gap between enrollments and is not expected.
    expect(outcome.ok && outcome.result.expectedDays).toBe(4);
  });
});

describe("summarizeAttendance — calendar exclusions", () => {
  it("excludes non-instructional (weekend/holiday) days from the denominator", () => {
    const outcome = summarizeAttendance({
      policy: policy(),
      interval: { from: "2026-06-01", to: "2026-06-07" },
      calendar: { instructionalDays: ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"] }, // 06 & 07 excluded (weekend)
      enrollments: [{ from: "2026-06-01", to: null }],
      records: [...["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"].map(present), { date: "2026-06-06", status: "absent" }],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.expectedDays).toBe(5);
    expect(outcome.result.percentage).toBe(100);
    expect(outcome.result.ignoredRecords).toEqual([{ date: "2026-06-06", reason: "non-instructional day" }]);
  });
});

describe("summarizeAttendance — missing vs recorded absence", () => {
  it("a missing entry is distinct from, and does not inflate, a recorded absence", () => {
    const days = ["2026-06-01", "2026-06-02", "2026-06-03"];
    const outcome = summarizeAttendance({
      policy: policy(),
      interval: { from: days[0]!, to: days[2]! },
      calendar: { instructionalDays: days },
      enrollments: [{ from: days[0]!, to: null }],
      records: [present("2026-06-01"), { date: "2026-06-02", status: "absent" }], // 06-03 has no record at all
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.expectedDays).toBe(3);
    expect(outcome.result.recordedDays).toBe(2);
    expect(outcome.result.missingDays).toBe(1);
    expect(outcome.result.missingDates).toEqual(["2026-06-03"]);
    expect(outcome.result.complete).toBe(false);
    expect(outcome.result.statusTotals.absent).toBe(1); // exactly one true recorded absence
    expect(outcome.result.percentage).toBeNull();
    expect(outcome.result.percentageUnavailableReason).toBe("incomplete");
  });

  it("an entered absence is never confused with a missing submission", () => {
    const outcome = summarizeAttendance(baseRequest({ records: [{ date: "2026-06-01", status: "absent" }, ...["2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"].map(present)] }));
    expect(outcome.ok && outcome.result.complete).toBe(true);
    expect(outcome.ok && outcome.result.missingDays).toBe(0);
    expect(outcome.ok && outcome.result.statusTotals.absent).toBe(1);
  });
});

describe("summarizeAttendance — explicit late/excused/half-day policy", () => {
  const days2 = ["2026-06-01", "2026-06-02"];
  function twoDayRequest(status: "excused" | "late" | "half-day", overrides: Partial<AttendancePolicy>) {
    return summarizeAttendance({
      policy: policy(overrides),
      interval: { from: days2[0]!, to: days2[1]! },
      calendar: { instructionalDays: days2 },
      enrollments: [{ from: days2[0]!, to: null }],
      records: [present(days2[0]!), { date: days2[1]!, status }],
    });
  }

  it("excused: excluded-from-denominator removes the day entirely", () => {
    const outcome = twoDayRequest("excused", { excusedTreatment: "excluded-from-denominator" });
    expect(outcome.ok && outcome.result.percentageDenominator).toBe(1);
    expect(outcome.ok && outcome.result.percentage).toBe(100);
  });

  it("excused: counts-as-absent keeps the day in the denominator uncredited", () => {
    const outcome = twoDayRequest("excused", { excusedTreatment: "counts-as-absent" });
    expect(outcome.ok && outcome.result.percentageDenominator).toBe(2);
    expect(outcome.ok && outcome.result.percentage).toBe(50);
  });

  it("late: counts-as-present gives full credit", () => {
    const outcome = twoDayRequest("late", { lateTreatment: "counts-as-present" });
    expect(outcome.ok && outcome.result.percentage).toBe(100);
  });

  it("late: counts-as-absent gives no credit", () => {
    const outcome = twoDayRequest("late", { lateTreatment: "counts-as-absent" });
    expect(outcome.ok && outcome.result.percentage).toBe(50);
  });

  it("half-day: half-credit gives exactly half a day", () => {
    const outcome = twoDayRequest("half-day", { halfDayTreatment: "half-credit" });
    expect(outcome.ok && outcome.result.presentEquivalentDays).toBe(1.5);
    expect(outcome.ok && outcome.result.percentage).toBe(75);
  });

  it("half-day: counts-as-present gives full credit", () => {
    const asPresent = twoDayRequest("half-day", { halfDayTreatment: "counts-as-present" });
    expect(asPresent.ok && asPresent.result.percentage).toBe(100);
  });

  it("half-day: counts-as-absent gives no credit", () => {
    const asAbsent = twoDayRequest("half-day", { halfDayTreatment: "counts-as-absent" });
    expect(asAbsent.ok && asAbsent.result.percentage).toBe(50);
  });
});

describe("summarizeAttendance — duplicate/conflicting records", () => {
  it("rejects two records for the same date, even with the same status", () => {
    const outcome = summarizeAttendance(baseRequest({ records: [present("2026-06-01"), present("2026-06-01"), ...["2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"].map(present)] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-record");
  });

  it("rejects two conflicting records for the same date", () => {
    const outcome = summarizeAttendance(baseRequest({ records: [present("2026-06-01"), { date: "2026-06-01", status: "absent" }] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-record");
  });
});

describe("summarizeAttendance — zero eligible days", () => {
  it("an interval with no instructional days is complete but has no percentage", () => {
    const outcome = summarizeAttendance(baseRequest({ calendar: { instructionalDays: [] } }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.expectedDays).toBe(0);
    expect(outcome.result.complete).toBe(true); // vacuously: 0 missing of 0 expected
    expect(outcome.result.percentage).toBeNull();
    expect(outcome.result.percentageUnavailableReason).toBe("zero-denominator");
  });

  it("every day excused with excluded-from-denominator also yields a zero denominator", () => {
    const days = ["2026-06-01", "2026-06-02"];
    const outcome = summarizeAttendance({
      policy: policy({ excusedTreatment: "excluded-from-denominator" }),
      interval: { from: days[0]!, to: days[1]! },
      calendar: { instructionalDays: days },
      enrollments: [{ from: days[0]!, to: null }],
      records: days.map((date) => ({ date, status: "excused" as const })),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.complete).toBe(true);
    expect(outcome.ok && outcome.result.percentageDenominator).toBe(0);
    expect(outcome.ok && outcome.result.percentage).toBeNull();
    expect(outcome.ok && outcome.result.percentageUnavailableReason).toBe("zero-denominator");
  });
});

describe("summarizeAttendance — leap day and date boundaries", () => {
  it("counts a leap day (2028-02-29) correctly", () => {
    const days = ["2028-02-28", "2028-02-29"];
    const outcome = summarizeAttendance({
      policy: policy(),
      interval: { from: days[0]!, to: days[1]! },
      calendar: { instructionalDays: days },
      enrollments: [{ from: days[0]!, to: null }],
      records: days.map(present),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.expectedDays).toBe(2);
    expect(outcome.ok && outcome.result.percentage).toBe(100);
  });

  it("rejects 2027-02-29 (not a leap year) wherever a date appears", () => {
    const outcome = summarizeAttendance(baseRequest({ interval: { from: "2027-02-29", to: "2027-03-01" } }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-interval");
  });

  it("correctly rolls a year boundary", () => {
    const days = ["2026-12-31", "2027-01-01"];
    const outcome = summarizeAttendance({
      policy: policy(),
      interval: { from: days[0]!, to: days[1]! },
      calendar: { instructionalDays: days },
      enrollments: [{ from: days[0]!, to: null }],
      records: days.map(present),
    });
    expect(outcome.ok && outcome.result.expectedDays).toBe(2);
    expect(outcome.ok && outcome.result.percentage).toBe(100);
  });
});

describe("summarizeAttendance — ordering independence", () => {
  it("shuffling records, enrollments and calendar order does not change the result", () => {
    const forward = summarizeAttendance(baseRequest());
    const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];
    const backward = summarizeAttendance(
      baseRequest({
        calendar: { instructionalDays: [...days].reverse() },
        records: [...days.map(present)].reverse(),
      }),
    );
    expect(forward.ok && backward.ok).toBe(true);
    expect(forward.ok && backward.ok && forward.result).toEqual(backward.ok ? backward.result : undefined);
  });
});

describe("summarizeAttendance — input validation", () => {
  it("rejects an invalid interval date", () => {
    const outcome = summarizeAttendance(baseRequest({ interval: { from: "2026-02-30", to: "2026-06-05" } }));
    expect(!outcome.ok && outcome.code).toBe("invalid-interval");
  });

  it("rejects interval.from after interval.to", () => {
    const outcome = summarizeAttendance(baseRequest({ interval: { from: "2026-06-05", to: "2026-06-01" } }));
    expect(!outcome.ok && outcome.code).toBe("invalid-interval");
  });

  it("rejects an invalid calendar date", () => {
    const outcome = summarizeAttendance(baseRequest({ calendar: { instructionalDays: ["2026-06-01", "not-a-date"] } }));
    expect(!outcome.ok && outcome.code).toBe("invalid-calendar");
  });

  it("rejects an empty enrollments array", () => {
    const outcome = summarizeAttendance(baseRequest({ enrollments: [] }));
    expect(!outcome.ok && outcome.code).toBe("invalid-enrollment");
  });

  it("rejects an enrollment with from after to", () => {
    const outcome = summarizeAttendance(baseRequest({ enrollments: [{ from: "2026-06-05", to: "2026-06-01" }] }));
    expect(!outcome.ok && outcome.code).toBe("invalid-enrollment");
  });

  it("rejects overlapping enrollment intervals", () => {
    const outcome = summarizeAttendance(
      baseRequest({ enrollments: [{ from: "2026-06-01", to: "2026-06-10" }, { from: "2026-06-05", to: null }] }),
    );
    expect(!outcome.ok && outcome.code).toBe("invalid-enrollment");
  });

  it("rejects an invalid record date", () => {
    const outcome = summarizeAttendance(baseRequest({ records: [{ date: "not-a-date", status: "present" }] }));
    expect(!outcome.ok && outcome.code).toBe("invalid-record");
  });

  it("rejects an unrecognized record status", () => {
    const outcome = summarizeAttendance(baseRequest({ records: [{ date: "2026-06-01", status: "tardy" as never }] }));
    expect(!outcome.ok && outcome.code).toBe("invalid-record");
  });

  it("rejects an unrecognized policy version", () => {
    const outcome = summarizeAttendance(baseRequest({ policy: { ...policy(), version: "v9" as never } }));
    expect(!outcome.ok && outcome.code).toBe("invalid-policy");
  });

  it.each(["lateTreatment", "excusedTreatment", "halfDayTreatment"] as const)("rejects an unrecognized %s value", (field) => {
    const outcome = summarizeAttendance(baseRequest({ policy: { ...policy(), [field]: "made-up-value" } as unknown as AttendancePolicy }));
    expect(!outcome.ok && outcome.code).toBe("invalid-policy");
  });
});

describe("summarizeAttendance — immutability", () => {
  it("does not mutate any input", () => {
    const request = deepFreeze(baseRequest());
    expect(() => summarizeAttendance(request)).not.toThrow();
  });
});
