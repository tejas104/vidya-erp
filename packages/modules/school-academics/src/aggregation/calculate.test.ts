import { describe, expect, it } from "vitest";
import { calculateWeightedResult } from "./calculate";
import { POLICY_VERSION, type AssessmentDefinition, type AssessmentEntry, type CalculationPolicy, type CalculationRequest } from "./contract";

function policy(overrides: Partial<CalculationPolicy> = {}): CalculationPolicy {
  return {
    version: POLICY_VERSION,
    typeWeights: [
      { typeId: "ca", weight: 40 },
      { typeId: "exam", weight: 60 },
    ],
    withinTypeAggregation: "equal-weighted-percentage",
    absentTreatment: "block",
    exemptTreatment: "block",
    missingTreatment: "block",
    ...overrides,
  };
}

function scored(assessmentId: string, score: number): AssessmentEntry {
  return { assessmentId, status: "scored", score };
}

function request(overrides: Partial<CalculationRequest> = {}): CalculationRequest {
  const assessments: AssessmentDefinition[] = [
    { id: "ca1", typeId: "ca", maxScore: 100 },
    { id: "exam1", typeId: "exam", maxScore: 100 },
  ];
  const entries: AssessmentEntry[] = [scored("ca1", 80), scored("exam1", 70)];
  return { policy: policy(), assessments, entries, ...overrides };
}

/** Deep-freeze so any accidental mutation throws under strict mode instead
 * of silently passing — the sharpest possible check for requirement #11. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("calculateWeightedResult — golden examples", () => {
  it("40% continuous assessment at 80%, 60% examination at 70% -> 74%", () => {
    const outcome = calculateWeightedResult(request());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.finalPercentage).toBe(74);
    expect(outcome.result.typeContributions).toEqual([
      { typeId: "ca", weight: 40, assessmentCount: 1, percentage: 80, weightedContribution: 32 },
      { typeId: "exam", weight: 60, assessmentCount: 1, percentage: 70, weightedContribution: 42 },
    ]);
    expect(outcome.result.policyVersion).toBe(POLICY_VERSION);
    expect(outcome.result.calculationVersion).toMatch(/engine/);
  });

  it("unequal maxima: equal-weighted-percentage and earned-points diverge", () => {
    const assessments: AssessmentDefinition[] = [
      { id: "a1", typeId: "ca", maxScore: 10 },
      { id: "a2", typeId: "ca", maxScore: 50 },
    ];
    const entries: AssessmentEntry[] = [scored("a1", 8), scored("a2", 45)]; // 80% and 90%
    const single = policy({ typeWeights: [{ typeId: "ca", weight: 100 }] });

    const equalWeighted = calculateWeightedResult({ policy: { ...single, withinTypeAggregation: "equal-weighted-percentage" }, assessments, entries });
    const earnedPoints = calculateWeightedResult({ policy: { ...single, withinTypeAggregation: "earned-points" }, assessments, entries });

    expect(equalWeighted.ok && equalWeighted.result.finalPercentage).toBe(85); // (80+90)/2
    expect(earnedPoints.ok && earnedPoints.result.finalPercentage).toBe(88.33); // (8+45)/(10+50) = 53/60
    expect(equalWeighted.ok && earnedPoints.ok && equalWeighted.result.finalPercentage !== earnedPoints.result.finalPercentage).toBe(true);
  });

  it("an entered zero is a valid score, distinct from missing", () => {
    const outcome = calculateWeightedResult(request({ entries: [scored("ca1", 0), scored("exam1", 70)] }));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.typeContributions[0]).toMatchObject({ typeId: "ca", percentage: 0 });
    expect(outcome.ok && outcome.result.finalPercentage).toBe(42); // 0*0.4 + 70*0.6
  });

  it("missing required work blocks the final result instead of guessing", () => {
    const outcome = calculateWeightedResult(request({ entries: [{ assessmentId: "ca1", status: "missing" }, scored("exam1", 70)] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("incomplete");
    expect(!outcome.ok && outcome.issues.some((issue) => issue.assessmentId === "ca1")).toBe(true);
  });

  it.each(["absent", "exempt"] as const)("an %s entry blocks the result rather than shrinking the denominator", (status) => {
    const assessments: AssessmentDefinition[] = [
      { id: "a1", typeId: "ca", maxScore: 100 },
      { id: "a2", typeId: "ca", maxScore: 100 },
    ];
    const entries: AssessmentEntry[] = [{ assessmentId: "a1", status }, scored("a2", 90)];
    const outcome = calculateWeightedResult({ policy: policy({ typeWeights: [{ typeId: "ca", weight: 100 }] }), assessments, entries });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("incomplete");
    // If the engine had silently redistributed weight, this would equal 90 (a2 alone).
    // It must not reach a numeric result at all.
    expect((outcome as { result?: unknown }).result).toBeUndefined();
  });

  it("a policy requesting an unimplemented treatment is rejected as unsupported, even with no absent data", () => {
    const bad = { ...policy(), absentTreatment: "zero" } as unknown as CalculationPolicy;
    const outcome = calculateWeightedResult(request({ policy: bad }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("unsupported-policy");
  });

  it("an unrecognized policy version is rejected as unsupported", () => {
    const bad = { ...policy(), version: "school-weighted-result.policy.v9" } as unknown as CalculationPolicy;
    const outcome = calculateWeightedResult(request({ policy: bad }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("unsupported-policy");
  });

  it("rounding-boundary ties round half-up deterministically", () => {
    // 1/32 * 100 = 3.125% — an exact tie at the third decimal place.
    const assessments: AssessmentDefinition[] = [{ id: "a1", typeId: "ca", maxScore: 32 }];
    const entries: AssessmentEntry[] = [scored("a1", 1)];
    const outcome = calculateWeightedResult({ policy: policy({ typeWeights: [{ typeId: "ca", weight: 100 }], withinTypeAggregation: "earned-points" }), assessments, entries });
    expect(outcome.ok && outcome.result.finalPercentage).toBe(3.13);
  });

  it("the maximum supported score computes a deterministic 100%", () => {
    const assessments: AssessmentDefinition[] = [{ id: "a1", typeId: "ca", maxScore: 9999.99 }];
    const entries: AssessmentEntry[] = [scored("a1", 9999.99)];
    const outcome = calculateWeightedResult({ policy: policy({ typeWeights: [{ typeId: "ca", weight: 100 }] }), assessments, entries });
    expect(outcome.ok && outcome.result.finalPercentage).toBe(100);
  });

  it("reordering equivalent assessments, entries and type weights does not change the result", () => {
    const assessments: AssessmentDefinition[] = [
      { id: "a1", typeId: "ca", maxScore: 10 },
      { id: "a2", typeId: "ca", maxScore: 50 },
      { id: "e1", typeId: "exam", maxScore: 100 },
    ];
    const entries: AssessmentEntry[] = [scored("a1", 8), scored("a2", 45), scored("e1", 70)];
    const forward = calculateWeightedResult({ policy: policy(), assessments, entries });

    const shuffledPolicy = policy({ typeWeights: [...policy().typeWeights].reverse() });
    const backward = calculateWeightedResult({
      policy: shuffledPolicy,
      assessments: [...assessments].reverse(),
      entries: [...entries].reverse(),
    });

    expect(forward.ok && backward.ok).toBe(true);
    expect(forward.ok && backward.ok && forward.result.finalPercentage).toBe(backward.ok && backward.result.finalPercentage);
  });

  it("does not mutate any input", () => {
    const req = deepFreeze(request());
    expect(() => calculateWeightedResult(req)).not.toThrow();
  });
});

describe("calculateWeightedResult — policy validation", () => {
  const invalidPolicies: Partial<CalculationPolicy>[] = [
    { typeWeights: [{ typeId: "ca", weight: 40 }, { typeId: "exam", weight: 59 }] }, // sums to 99
    { typeWeights: [] }, // no types
    { typeWeights: [{ typeId: "ca", weight: 50 }, { typeId: "ca", weight: 50 }] }, // duplicate type id
    { typeWeights: [{ typeId: "ca", weight: 0 }, { typeId: "exam", weight: 100 }] }, // zero weight
    { typeWeights: [{ typeId: "ca", weight: 40.5 }, { typeId: "exam", weight: 59.5 }] }, // fractional weight
    { withinTypeAggregation: "median" as unknown as CalculationPolicy["withinTypeAggregation"] },
  ];

  it.each(invalidPolicies)("rejects an invalid policy %#", (overrides) => {
    const outcome = calculateWeightedResult(request({ policy: policy(overrides) }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-policy");
  });
});

describe("calculateWeightedResult — assessment validation", () => {
  it.each([
    [{ id: "ca1", typeId: "ca", maxScore: 0 }], // zero maximum
    [{ id: "ca1", typeId: "ca", maxScore: -5 }], // negative maximum
    [{ id: "ca1", typeId: "ca", maxScore: Number.NaN }], // non-finite
    [{ id: "ca1", typeId: "ca", maxScore: Number.POSITIVE_INFINITY }],
    [{ id: "ca1", typeId: "ca", maxScore: 100.001 }], // more than 2 decimal places
    [{ id: "ca1", typeId: "ca", maxScore: 10000 }], // exceeds MAX_SCORE
    [{ id: "ca1", typeId: "unknown-type", maxScore: 100 }], // dangling type reference
  ])("rejects an invalid assessment definition %#", (assessment) => {
    const outcome = calculateWeightedResult(request({ assessments: [assessment, { id: "exam1", typeId: "exam", maxScore: 100 }], entries: [scored("ca1", 50), scored("exam1", 70)] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-assessment");
  });

  it("rejects duplicate assessment identifiers", () => {
    const outcome = calculateWeightedResult(
      request({
        assessments: [{ id: "ca1", typeId: "ca", maxScore: 100 }, { id: "ca1", typeId: "exam", maxScore: 100 }],
        entries: [scored("ca1", 50)],
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-assessment");
  });
});

describe("calculateWeightedResult — entry validation", () => {
  it.each([
    [scored("ca1", -1)], // negative score
    [scored("ca1", 100.5)], // exceeds this assessment's max (100)
    [scored("ca1", Number.NaN)],
    [scored("ca1", 80.005)], // more than 2 decimal places
  ])("rejects an invalid scored entry %#", (entry) => {
    const outcome = calculateWeightedResult(request({ entries: [entry, scored("exam1", 70)] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-entry");
  });

  it("rejects a score attached to a non-scored status", () => {
    const outcome = calculateWeightedResult(request({ entries: [{ assessmentId: "ca1", status: "absent", score: 10 }, scored("exam1", 70)] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-entry");
  });

  it("rejects an entry for an unknown assessment", () => {
    const outcome = calculateWeightedResult(request({ entries: [scored("ca1", 80), scored("exam1", 70), scored("ghost", 10)] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-entry");
  });

  it("rejects an entry with an unrecognized status instead of silently blocking on it", () => {
    const bad = { assessmentId: "ca1", status: "excused" } as unknown as AssessmentEntry;
    const outcome = calculateWeightedResult(request({ entries: [bad, scored("exam1", 70)] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-entry");
  });

  it("rejects a duplicate entry for the same assessment", () => {
    const outcome = calculateWeightedResult(request({ entries: [scored("ca1", 80), scored("ca1", 90), scored("exam1", 70)] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-entry");
  });

  it("rejects an assessment with no entry at all instead of assuming a status", () => {
    const outcome = calculateWeightedResult(request({ entries: [scored("exam1", 70)] }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("invalid-entry");
  });
});

describe("calculateWeightedResult — incomplete data", () => {
  it("a weighted type with zero supplied assessments blocks the result", () => {
    const outcome = calculateWeightedResult(
      request({
        assessments: [{ id: "exam1", typeId: "exam", maxScore: 100 }],
        entries: [scored("exam1", 70)],
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("incomplete");
  });
});
