import { describe, expect, it } from "vitest";
import { CLOCK_ROLLBACK_TOLERANCE_DAYS, evaluateClock, isoDay } from "./clock-watermark";

const at = (iso: string) => new Date(`${iso}T09:30:00.000Z`);

describe("evaluateClock (DECISION 2 — high-water clock mark)", () => {
  it("seeds the mark on a first run and reports no regression", () => {
    expect(evaluateClock(null, at("2026-09-11"))).toEqual({
      effectiveOn: "2026-09-11",
      rolledBackDays: null,
      advanceTo: "2026-09-11",
    });
  });

  it("advances the mark as time moves forward", () => {
    expect(evaluateClock("2026-09-11", at("2026-09-12"))).toEqual({
      effectiveOn: "2026-09-12",
      rolledBackDays: null,
      advanceTo: "2026-09-12",
    });
  });

  it("does not rewrite the mark when the day has not changed", () => {
    const decision = evaluateClock("2026-09-11", at("2026-09-11"));
    expect(decision.advanceTo).toBeNull();
    expect(decision.rolledBackDays).toBeNull();
    expect(decision.effectiveOn).toBe("2026-09-11");
  });

  it("tolerates a one-day regression — an NTP correction must never be an incident", () => {
    const decision = evaluateClock("2026-09-12", at("2026-09-11"));
    expect(decision.rolledBackDays).toBeNull();
    expect(decision.effectiveOn).toBe("2026-09-11"); // the wall clock is still trusted
    expect(decision.advanceTo).toBeNull(); // but the mark never moves backwards
  });

  it("flags the first day past tolerance, and holds the licence at the mark", () => {
    const decision = evaluateClock("2026-09-13", at("2026-09-11"));
    expect(decision.rolledBackDays).toBe(CLOCK_ROLLBACK_TOLERANCE_DAYS + 1);
    expect(decision.effectiveOn).toBe("2026-09-13");
    // Advancing here would launder the regression away — the next boot would
    // see a mark that agrees with the rolled-back clock and report nothing.
    expect(decision.advanceTo).toBeNull();
  });

  it("counts a long rollback correctly across a year boundary", () => {
    const decision = evaluateClock("2027-06-01", at("2026-01-01"));
    expect(decision.rolledBackDays).toBe(516);
    expect(decision.effectiveOn).toBe("2027-06-01");
  });

  it("counts across a month boundary (the off-by-one this is most likely to get wrong)", () => {
    expect(evaluateClock("2026-10-01", at("2026-09-29")).rolledBackDays).toBe(2);
    expect(evaluateClock("2026-10-01", at("2026-09-30")).rolledBackDays).toBeNull();
  });

  it("reads the day in UTC, so a late-evening local time is not a rollback", () => {
    expect(isoDay(new Date("2026-09-11T23:59:59.999Z"))).toBe("2026-09-11");
    expect(isoDay(new Date("2026-09-12T00:00:00.000Z"))).toBe("2026-09-12");
  });
});
