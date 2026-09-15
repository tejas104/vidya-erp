/**
 * Exact rational arithmetic for the weighted-result engine.
 *
 * Every score, maximum, and weight the engine consumes is a decimal with a
 * known, bounded number of fractional digits (scores: at most 2dp, capped at
 * MAX_SCORE; weights: whole percentages). Representing each as an exact
 * BigInt fraction — instead of doing the arithmetic in `number` — means sums
 * of percentages and weighted averages never accumulate floating-point
 * error, and the result of a computation is independent of the order its
 * inputs were summed in (BigInt addition/multiplication is exact).
 *
 * Rounding happens in exactly one place: `roundToCents`, used only at the
 * two documented boundaries (a type's aggregated percentage, and the final
 * weighted percentage) in calculate.ts. Every intermediate value stays an
 * exact fraction. Rounding mode is half-up (ties round away from zero);
 * every value this module ever rounds is non-negative, so that is
 * equivalent to "round half away from zero" — e.g. 74.005 -> 74.01.
 *
 * Bounds: inputs are validated by calculate.ts to be finite numbers with at
 * most `SCORE_DECIMALS` (2) fractional digits and magnitude <= MAX_SCORE
 * (9999.99) before reaching `fromDecimal`; `fromDecimal`'s `Math.round`
 * exists only to snap away the float-representation noise on such
 * already-validated values (e.g. 80.29 stored as 80.28999999999999), not to
 * round arbitrary numbers.
 */

export interface Rational {
  readonly num: bigint;
  readonly den: bigint; // always > 0
}

export const ZERO: Rational = { num: 0n, den: 1n };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x === 0n ? 1n : x;
}

function reduce(num: bigint, den: bigint): Rational {
  if (den === 0n) throw new Error("Rational denominator must not be zero.");
  const sign = den < 0n ? -1n : 1n;
  const n = num * sign;
  const d = den * sign;
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}

export function fromInt(value: number): Rational {
  return reduce(BigInt(value), 1n);
}

/** `value` must already be a finite number with at most `decimals`
 * fractional digits (the caller validates this before calling). */
export function fromDecimal(value: number, decimals: number = 2): Rational {
  const scale = 10 ** decimals;
  return reduce(BigInt(Math.round(value * scale)), BigInt(scale));
}

export function add(a: Rational, b: Rational): Rational {
  return reduce(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function multiply(a: Rational, b: Rational): Rational {
  return reduce(a.num * b.num, a.den * b.den);
}

export function divide(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new Error("Cannot divide by zero.");
  return reduce(a.num * b.den, a.den * b.num);
}

export function divideByInt(a: Rational, n: number): Rational {
  if (n === 0) throw new Error("Cannot divide by zero.");
  return reduce(a.num, a.den * BigInt(n));
}

export function sum(values: readonly Rational[]): Rational {
  return values.reduce(add, ZERO);
}

/** Round a non-negative Rational to 2 decimal places, half-up, as a number. */
export function roundToCents(value: Rational): number {
  if (value.num < 0n) throw new Error("roundToCents only supports non-negative values.");
  const scaledNum = value.num * 100n;
  const wholeCents = scaledNum / value.den;
  const remainder = scaledNum % value.den;
  const rounded = remainder * 2n >= value.den ? wholeCents + 1n : wholeCents;
  return Number(rounded) / 100;
}
