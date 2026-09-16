import { describe, expect, it } from "vitest";
import { MAX_PAISE_AMOUNT, paiseSchema } from "./definition";

/**
 * S04 correctness finding — numeric bounds: `paiseSchema` previously allowed
 * any positive integer with no ceiling, so a value larger than Postgres
 * `integer`'s 2,147,483,647 range (every fee amount column is `integer`,
 * db/schema.ts) passed validation and only failed later, uncaught, as a raw
 * DB error at INSERT time (a generic 500, not a clean 400) —
 * docs/audits/school-fee-correctness.md, "currency precision and numeric
 * bounds."
 */
describe("paiseSchema — numeric bounds (S04 finding)", () => {
  it.each([1, 100, 50_000, MAX_PAISE_AMOUNT])("accepts an ordinary or boundary-maximum amount: %i", (amount) => {
    expect(paiseSchema.safeParse(amount).success).toBe(true);
  });

  it("rejects an amount one paisa above the cap", () => {
    expect(paiseSchema.safeParse(MAX_PAISE_AMOUNT + 1).success).toBe(false);
  });

  it("rejects an amount that would overflow Postgres's integer column (previously an uncaught DB error, not a validation error)", () => {
    const result = paiseSchema.safeParse(2_147_483_648); // one past int4's max
    expect(result.success).toBe(false);
  });

  it("the cap itself stays comfortably under int4's actual ceiling", () => {
    expect(MAX_PAISE_AMOUNT).toBeLessThan(2_147_483_647);
  });

  it.each([0, -1, -50_000, 1.5])("still rejects non-positive or non-integer amounts (pre-existing behavior, unchanged)", (amount) => {
    expect(paiseSchema.safeParse(amount).success).toBe(false);
  });
});
