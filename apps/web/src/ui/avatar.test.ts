import { describe, expect, it } from "vitest";
import { AVATARS, initials } from "./avatar";

/** WCAG 2.x relative luminance / contrast ratio. Kept here — no production caller needs it. */
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every #rrggbb stop in a `linear-gradient(...)` string. */
const stopsOf = (gradient: string) => gradient.match(/#[0-9a-fA-F]{6}/g) ?? [];

// The initials render at 16px/700, which is NOT WCAG "large text" (that starts at
// 18.66px bold), so the bar is 4.5:1 rather than 3:1.
const AA_NORMAL = 4.5;

describe("AVATARS palette accessibility", () => {
  it("every palette declares a gradient with at least two stops and an ink", () => {
    expect(AVATARS.length).toBeGreaterThan(0);
    for (const { gradient, ink } of AVATARS) {
      expect(stopsOf(gradient).length).toBeGreaterThanOrEqual(2);
      expect(ink).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  // The load-bearing test: text sits on a gradient, so the ink must clear the bar
  // at EVERY stop, not on an average or a single sampled end.
  it.each(AVATARS.map((p, i) => [i, p] as const))(
    "palette %i initials clear AA against every gradient stop",
    (_i, palette) => {
      for (const stop of stopsOf(palette.gradient)) {
        expect(contrast(palette.ink, stop)).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    },
  );

  it("computes contrast correctly (guards the assertion above from silently passing)", () => {
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // A known failure: white on the amber palette's light stop is ~2.15:1.
    expect(contrast("#FFFFFF", "#F59E0B")).toBeLessThan(AA_NORMAL);
  });
});

describe("initials", () => {
  it("takes the first and last word's initials", () => {
    expect(initials("Asha Rao")).toBe("AR");
    expect(initials("Asha Kumari Rao")).toBe("AR");
  });
  it("handles a single name, extra whitespace and an empty string", () => {
    expect(initials("Asha")).toBe("A");
    expect(initials("  Asha   Rao  ")).toBe("AR");
    expect(initials("")).toBe("·");
  });
});
