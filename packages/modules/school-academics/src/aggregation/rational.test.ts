import { describe, expect, it } from "vitest";
import { add, divide, divideByInt, fromDecimal, fromInt, multiply, roundToCents, sum, ZERO } from "./rational";

describe("rational arithmetic", () => {
  it("represents a decimal score exactly, surviving float noise on the way in", () => {
    // 0.29 * 100 is 28.999999999999996 in IEEE-754; fromDecimal must still land on 29/100.
    const r = fromDecimal(80.29);
    expect(r.num).toBe(8029n);
    expect(r.den).toBe(100n);
  });

  it("reduces fractions to lowest terms", () => {
    const r = fromDecimal(50); // 5000/100
    expect(r.num).toBe(50n);
    expect(r.den).toBe(1n);
  });

  it("adds exactly, unlike IEEE-754 (0.1 + 0.2 !== 0.3 in plain floats)", () => {
    const total = add(fromDecimal(0.1), fromDecimal(0.2));
    expect(total.num).toBe(3n);
    expect(total.den).toBe(10n);
  });

  it("sums many terms without floating point drift", () => {
    const total = sum([fromDecimal(0.1), fromDecimal(0.2), fromDecimal(0.3)]);
    expect(roundToCents(total)).toBe(0.6);
  });

  it("divide computes an exact percentage ratio", () => {
    const pct = multiply(divide(fromDecimal(8), fromDecimal(10)), fromInt(100));
    expect(roundToCents(pct)).toBe(80);
  });

  it("is commutative under reordering: sum order does not change the exact value", () => {
    const a = fromDecimal(33.33);
    const b = fromDecimal(66.67);
    const c = fromDecimal(12.5);
    const forward = sum([a, b, c]);
    const backward = sum([c, b, a]);
    expect(forward.num * backward.den).toBe(backward.num * forward.den); // exact equality of fractions
  });

  it("divideByInt averages three exact thirds back to a whole", () => {
    const third = divideByInt(fromInt(1), 3);
    const total = sum([third, third, third]);
    expect(roundToCents(total)).toBe(1);
  });

  it("rounds half-up at the documented 2dp boundary", () => {
    expect(roundToCents(fromDecimal(74.005, 3))).toBe(74.01);
    expect(roundToCents(fromDecimal(74.004, 3))).toBe(74);
    expect(roundToCents(fromDecimal(0.005, 3))).toBe(0.01);
  });

  it("treats zero as a valid, distinct rational value", () => {
    expect(roundToCents(ZERO)).toBe(0);
    expect(roundToCents(fromDecimal(0))).toBe(0);
  });

  it("rejects division by zero instead of returning Infinity/NaN", () => {
    expect(() => divide(fromInt(1), ZERO)).toThrow();
    expect(() => divideByInt(fromInt(1), 0)).toThrow();
  });

  it("handles the maximum supported score deterministically", () => {
    const pct = multiply(divide(fromDecimal(9999.99), fromDecimal(9999.99)), fromInt(100));
    expect(roundToCents(pct)).toBe(100);
  });
});
