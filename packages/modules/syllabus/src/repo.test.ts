import { describe, it, expect } from "vitest";
import { coveragePct } from "./repo";

describe("coveragePct", () => {
  it("is 0 for no topics", () => expect(coveragePct([])).toBe(0));
  it("is 0 when none taught", () => expect(coveragePct([{ taughtOn: null }, { taughtOn: null }])).toBe(0));
  it("is 100 when all taught", () => expect(coveragePct([{ taughtOn: "2026-07-01" }])).toBe(100));
  it("rounds partial coverage", () =>
    expect(coveragePct([{ taughtOn: "2026-07-01" }, { taughtOn: null }, { taughtOn: null }])).toBe(33));
});
