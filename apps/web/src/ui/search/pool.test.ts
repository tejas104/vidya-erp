import { describe, expect, it } from "vitest";
import { mapPool } from "./pool";

describe("mapPool", () => {
  it("caps concurrency, preserves order, reports progress", async () => {
    let inflight = 0;
    let maxSeen = 0;
    const prog: number[] = [];
    const out = await mapPool(
      [1, 2, 3, 4, 5],
      2,
      async (n) => {
        inflight++;
        maxSeen = Math.max(maxSeen, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        return n * 2;
      },
      (done) => prog.push(done),
    );
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(maxSeen).toBeLessThanOrEqual(2);
    expect(prog[prog.length - 1]).toBe(5);
  });

  it("handles an empty list without spawning workers", async () => {
    const out = await mapPool([], 4, async () => 1);
    expect(out).toEqual([]);
  });
});
