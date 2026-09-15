/**
 * S01 correction regressions (Astra findings F2, F3, F4). Independent of
 * calculate.test.ts and written from the review's reproduction steps, not
 * from the implementation — each case restates an expected value rather
 * than re-deriving the code's own arithmetic.
 */
import { describe, expect, it } from "vitest";
import { calculateWeightedResult } from "./calculate";
import { POLICY_VERSION, type CalculationPolicy, type CalculationRequest } from "./contract";

function policy(overrides: Partial<CalculationPolicy> = {}): CalculationPolicy {
  return {
    version: POLICY_VERSION,
    typeWeights: [{ typeId: "a", weight: 100 }],
    withinTypeAggregation: "equal-weighted-percentage",
    absentTreatment: "block",
    exemptTreatment: "block",
    missingTreatment: "block",
    ...overrides,
  };
}

/** A single weighted type with one assessment, so a maxScore/score pair can
 * be probed in isolation without any other validation rule interfering. */
function singleAssessmentRequest(maxScore: number, score: number): CalculationRequest {
  return {
    policy: policy(),
    assessments: [{ id: "a1", typeId: "a", maxScore }],
    entries: [{ assessmentId: "a1", status: "scored", score }],
  };
}

describe("F2 — decimal validation no longer admits a maximum that collapses to zero", () => {
  it.each([1e-10, 1e-9, 1e-6, 0.001, 0.004, 0.005])("rejects tiny positive maximum %s before any arithmetic", (maxScore) => {
    const outcome = calculateWeightedResult(singleAssessmentRequest(maxScore, 0));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-assessment");
    // The defect was a thrown "Cannot divide by zero." escaping the outcome
    // contract — asserting `ok` is a boolean (not a thrown exception) is
    // itself part of what this regression pins, on top of the code above.
  });

  it("never throws for a tiny maximum, unlike the original defect", () => {
    expect(() => calculateWeightedResult(singleAssessmentRequest(1e-10, 0))).not.toThrow();
  });

  it.each([80.297, 0.001, 33.333, 9999.999])("rejects an unsupported extra decimal place on the maximum: %s", (maxScore) => {
    const outcome = calculateWeightedResult(singleAssessmentRequest(maxScore, 0));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-assessment");
  });

  it.each([80.005, 1.005])("rejects an unsupported extra decimal place on a score: %s", (score) => {
    const outcome = calculateWeightedResult(singleAssessmentRequest(100, score));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-entry");
  });

  it("accepts the smallest valid maximum, 0.01", () => {
    const outcome = calculateWeightedResult(singleAssessmentRequest(0.01, 0.01));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.finalPercentage).toBe(100);
  });

  it("accepts the maximum supported value, 9999.99", () => {
    const outcome = calculateWeightedResult(singleAssessmentRequest(9999.99, 9999.99));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.finalPercentage).toBe(100);
  });

  it("rejects a maximum just above the supported range (10000)", () => {
    const outcome = calculateWeightedResult(singleAssessmentRequest(10000, 0));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-assessment");
  });

  it("still accepts an ordinary supported decimal score, 80.29", () => {
    const outcome = calculateWeightedResult(singleAssessmentRequest(100, 80.29));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.finalPercentage).toBe(80.29);
  });

  it.each([0.02, 3.33, 99.98, 0.99])("still accepts ordinary two-decimal maxima: %s", (maxScore) => {
    const outcome = calculateWeightedResult(singleAssessmentRequest(maxScore, maxScore));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.finalPercentage).toBe(100);
  });
});

describe("F3 — the explanatory rounding contract", () => {
  it("two equally weighted 1/3 types: contributions 16.67 + 16.67, final 33.33 (not their sum, not 33.34)", () => {
    const req: CalculationRequest = {
      policy: policy({ typeWeights: [{ typeId: "a", weight: 50 }, { typeId: "b", weight: 50 }] }),
      assessments: [
        { id: "a1", typeId: "a", maxScore: 3 },
        { id: "b1", typeId: "b", maxScore: 3 },
      ],
      entries: [
        { assessmentId: "a1", status: "scored", score: 1 },
        { assessmentId: "b1", status: "scored", score: 1 },
      ],
    };
    const outcome = calculateWeightedResult(req);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.typeContributions.map((c) => c.weightedContribution)).toEqual([16.67, 16.67]);
    // The exact aggregate contract: finalPercentage is correct (33.33 rounded
    // from the true 100/3), and is deliberately NOT patched to equal the
    // displayed rows' sum.
    expect(outcome.result.finalPercentage).toBe(33.33);
    expect(outcome.result.finalPercentage).not.toBe(33.34);

    const displayedSum = outcome.result.typeContributions.reduce((sum, c) => sum + c.weightedContribution, 0);
    expect(displayedSum).toBeCloseTo(33.34, 5);
    // The documented contract: the displayed rows are explanatory, not a
    // reconciling breakdown — their sum is allowed to differ from
    // finalPercentage, and here it demonstrably does.
    expect(displayedSum).not.toBe(outcome.result.finalPercentage);
  });
});

describe("F4 — malformed input shapes never throw and return a structured failure", () => {
  const base: CalculationRequest = {
    policy: policy({ typeWeights: [{ typeId: "a", weight: 50 }, { typeId: "b", weight: 50 }] }),
    assessments: [
      { id: "a1", typeId: "a", maxScore: 10 },
      { id: "b1", typeId: "b", maxScore: 10 },
    ],
    entries: [
      { assessmentId: "a1", status: "scored", score: 5 },
      { assessmentId: "b1", status: "scored", score: 5 },
    ],
  };

  it("a null request returns a failure instead of throwing", () => {
    expect(() => calculateWeightedResult(null as unknown as CalculationRequest)).not.toThrow();
    const outcome = calculateWeightedResult(null as unknown as CalculationRequest);
    expect(outcome.ok).toBe(false);
  });

  it("a null policy returns invalid-policy instead of throwing", () => {
    const req = { ...base, policy: null } as unknown as CalculationRequest;
    expect(() => calculateWeightedResult(req)).not.toThrow();
    const outcome = calculateWeightedResult(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-policy");
  });

  it("a null element in policy.typeWeights returns invalid-policy instead of throwing", () => {
    const req = { ...base, policy: { ...base.policy, typeWeights: [null] } } as unknown as CalculationRequest;
    expect(() => calculateWeightedResult(req)).not.toThrow();
    const outcome = calculateWeightedResult(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-policy");
  });

  it("a null element in assessments returns invalid-assessment instead of throwing", () => {
    const req = { ...base, assessments: [null, base.assessments[1]] } as unknown as CalculationRequest;
    expect(() => calculateWeightedResult(req)).not.toThrow();
    const outcome = calculateWeightedResult(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-assessment");
  });

  it("a null entries container returns invalid-entry instead of throwing", () => {
    const req = { ...base, entries: null } as unknown as CalculationRequest;
    expect(() => calculateWeightedResult(req)).not.toThrow();
    const outcome = calculateWeightedResult(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-entry");
  });

  it("a null element in entries returns invalid-entry instead of throwing", () => {
    const req = { ...base, entries: [null, base.entries[1]] } as unknown as CalculationRequest;
    expect(() => calculateWeightedResult(req)).not.toThrow();
    const outcome = calculateWeightedResult(req);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-entry");
  });

  it("does not conceal a genuine programmer error by blanket-catching: valid input still computes normally", () => {
    // Guards against a "fix" that wraps the whole function in try/catch —
    // that would also mask real bugs. A well-formed request must still
    // succeed and compute the real answer, not merely "not throw".
    const outcome = calculateWeightedResult(base);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.finalPercentage).toBe(50);
  });
});
