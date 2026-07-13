import { describe, expect, it } from "vitest";
import { bandFor, cgpa, meanPct, sgpa, type Band } from "./gpa";

/** The plan's golden scale: 90→A+/10 · 80→A/9 · 70→B+/8 · 60→B/7 · 50→C/6 · 40→D/5 · 0→F/0. */
const SCALE: Band[] = [
  { minPct: 90, grade: "A+", points: 10 },
  { minPct: 80, grade: "A", points: 9 },
  { minPct: 70, grade: "B+", points: 8 },
  { minPct: 60, grade: "B", points: 7 },
  { minPct: 50, grade: "C", points: 6 },
  { minPct: 40, grade: "D", points: 5 },
  { minPct: 0, grade: "F", points: 0 },
];

describe("golden numbers (binding, from the master plan R1)", () => {
  it("Alpha: DS 78.5 (mean of 80/75/80.5) B+, MTH 62 B, DBMS 91 A+ ⇒ SGPA 8.30", () => {
    const ds = meanPct([80, 75, 80.5]);
    expect(ds).toBe(78.5);
    expect(bandFor(SCALE, ds!).grade).toBe("B+");
    expect(bandFor(SCALE, 62).grade).toBe("B");
    expect(bandFor(SCALE, 91).grade).toBe("A+");
    expect(
      sgpa([
        { points: 8, credits: 4 },
        { points: 7, credits: 3 },
        { points: 10, credits: 3 },
      ]),
    ).toBe(8.3);
  });

  it("Beta: 34 F, exactly 50 C (inclusive minimum), 69.95 B (not B+) ⇒ SGPA 3.90", () => {
    expect(bandFor(SCALE, 34).grade).toBe("F");
    expect(bandFor(SCALE, 50).grade).toBe("C");
    expect(bandFor(SCALE, 69.95).grade).toBe("B");
    expect(
      sgpa([
        { points: 0, credits: 4 },
        { points: 6, credits: 3 },
        { points: 7, credits: 3 },
      ]),
    ).toBe(3.9);
  });

  it("CGPA: 8.30 over 10 credits + 9.10 over 12 credits ⇒ 8.74 (credit-weighted)", () => {
    expect(
      cgpa([
        { sgpa: 8.3, credits: 10 },
        { sgpa: 9.1, credits: 12 },
      ]),
    ).toBe(8.74);
  });

  it("degenerate: no marks ⇒ nulls, never invented zeros", () => {
    expect(meanPct([])).toBeNull();
    expect(sgpa([])).toBeNull();
    expect(cgpa([])).toBeNull();
  });

  it("band edges: 0 lands in F, 100 in A+, 89.99 stays A", () => {
    expect(bandFor(SCALE, 0).grade).toBe("F");
    expect(bandFor(SCALE, 100).grade).toBe("A+");
    expect(bandFor(SCALE, 89.99).grade).toBe("A");
  });
});
