import { describe, expect, it } from "vitest";
import { deriveNow, type NowEntry } from "./nowPeriod";
import type { TtToday } from "@/ui/api";

function entry(periodNo: number, id = `tte_${periodNo}`): NowEntry {
  return {
    id,
    sectionId: "sec_1",
    sectionName: "A",
    className: "FY CS",
    subjectId: `sub_${periodNo}`,
    subjectName: `Subject ${periodNo}`,
    teacherId: "tch_1",
    teacherName: "T",
    room: "204",
    dayOfWeek: 1,
    periodNo,
  };
}

type TtPeriodFixture = { periodNo: number; starts: string; ends: string };

// Three back-to-back periods, no gaps: 09:00-09:50, 09:50-10:40, 10:40-11:30.
const threePeriods: TtPeriodFixture[] = [
  { periodNo: 1, starts: "09:00", ends: "09:50" },
  { periodNo: 2, starts: "09:50", ends: "10:40" },
  { periodNo: 3, starts: "10:40", ends: "11:30" },
];

function today(periods: TtPeriodFixture[], entries: NowEntry[], dayOfWeek = 1): TtToday {
  return { dayOfWeek, periods, entries };
}

const toMin = (h: number, m: number) => h * 60 + m;

describe("deriveNow", () => {
  it("no-timetable: the college has no periods configured at all", () => {
    expect(deriveNow(today([], []), toMin(9, 30))).toEqual({ kind: "no-timetable" });
  });

  it("off-day: dayOfWeek 0 (a non-teaching day) even if periods exist", () => {
    const state = deriveNow(today(threePeriods, [entry(1)], 0), toMin(9, 30));
    expect(state).toEqual({ kind: "off-day" });
  });

  it("no-classes: periods exist for the college but none assigned to this teacher today", () => {
    const state = deriveNow(today(threePeriods, []), toMin(9, 30));
    expect(state).toEqual({ kind: "no-classes" });
  });

  it("before the first period: features the first period as upcoming, not ongoing", () => {
    const state = deriveNow(today(threePeriods, [entry(1), entry(2), entry(3)]), toMin(8, 30));
    if (state.kind !== "active") throw new Error("expected active");
    expect(state.ongoing).toBe(false);
    expect(state.featured.entry.periodNo).toBe(1);
    expect(state.remaining.map((s) => s.entry.periodNo)).toEqual([2, 3]);
  });

  it("mid-period: the containing period is ongoing", () => {
    const state = deriveNow(today(threePeriods, [entry(1), entry(2), entry(3)]), toMin(9, 20));
    if (state.kind !== "active") throw new Error("expected active");
    expect(state.ongoing).toBe(true);
    expect(state.featured.entry.periodNo).toBe(1);
    expect(state.remaining.map((s) => s.entry.periodNo)).toEqual([2, 3]);
  });

  it("exact start boundary: the new period is ongoing the instant it starts (inclusive start)", () => {
    const state = deriveNow(today(threePeriods, [entry(1), entry(2), entry(3)]), toMin(9, 50));
    if (state.kind !== "active") throw new Error("expected active");
    expect(state.ongoing).toBe(true);
    expect(state.featured.entry.periodNo).toBe(2);
  });

  it("back-to-back handoff: no dead minute where neither period is featured", () => {
    // At the exact boundary minute, period 1 has ended (exclusive end) and
    // period 2 has begun (inclusive start) — period 2 must be featured, and
    // period 1 must not still be "ongoing".
    const state = deriveNow(today(threePeriods, [entry(1), entry(2), entry(3)]), toMin(9, 50));
    if (state.kind !== "active") throw new Error("expected active");
    expect(state.featured.entry.periodNo).not.toBe(1);
    expect(state.featured.entry.periodNo).toBe(2);
  });

  it("gap between periods: featured is the next upcoming period, not ongoing", () => {
    const gapped = [
      { periodNo: 1, starts: "09:00", ends: "09:50" },
      { periodNo: 2, starts: "10:00", ends: "10:50" }, // 10-minute gap
    ];
    const state = deriveNow(today(gapped, [entry(1), entry(2)]), toMin(9, 55));
    if (state.kind !== "active") throw new Error("expected active");
    expect(state.ongoing).toBe(false);
    expect(state.featured.entry.periodNo).toBe(2);
  });

  it("after the last period ends: day-done", () => {
    const state = deriveNow(today(threePeriods, [entry(1), entry(2), entry(3)]), toMin(11, 30));
    expect(state).toEqual({ kind: "day-done" });
  });

  it("exact end boundary of the last period: day-done (end is exclusive)", () => {
    const state = deriveNow(today(threePeriods, [entry(1)]), toMin(9, 50));
    expect(state).toEqual({ kind: "day-done" });
  });

  it("remaining excludes periods already done, keeps future ones in order", () => {
    const state = deriveNow(today(threePeriods, [entry(1), entry(2), entry(3)]), toMin(10, 45));
    if (state.kind !== "active") throw new Error("expected active");
    expect(state.featured.entry.periodNo).toBe(3);
    expect(state.remaining).toEqual([]);
  });

  it("an entry referencing a period not in the periods list stays visible, never asserted done", () => {
    const orphan = entry(9, "tte_orphan");
    const state = deriveNow(today(threePeriods, [entry(1), orphan]), toMin(11, 30));
    // period 1 is long done and there's no ongoing/upcoming match (orphan has
    // no known start/end) — nothing to feature, so the day reads as done...
    expect(state).toEqual({ kind: "day-done" });
  });

  it("an unresolved-period entry rides along in remaining once something else is featured", () => {
    const orphan = entry(9, "tte_orphan");
    const state = deriveNow(today(threePeriods, [entry(1), entry(2), orphan]), toMin(9, 20));
    if (state.kind !== "active") throw new Error("expected active");
    expect(state.featured.entry.periodNo).toBe(1);
    expect(state.remaining.some((s) => s.entry.id === "tte_orphan")).toBe(true);
  });
});
