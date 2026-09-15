/**
 * calculateWeightedResult — the pure entry point of the S01 calculation
 * engine. No database access, HTTP, authorization, logging, current-time
 * dependency, or global mutable state; every input is validated and the
 * function always returns a `CalculationOutcome`, never throws for bad
 * input. Inputs are never mutated.
 */
import {
  ENGINE_VERSION,
  MAX_SCORE,
  POLICY_VERSION,
  SCORE_DECIMALS,
  type AssessmentDefinition,
  type AssessmentEntry,
  type CalculationFailureCode,
  type CalculationIssue,
  type CalculationOutcome,
  type CalculationPolicy,
  type CalculationRequest,
  type TypeContribution,
  type WithinTypeAggregation,
} from "./contract";
import { add, divide, divideByInt, fromDecimal, fromInt, multiply, roundToCents, sum, ZERO, type Rational } from "./rational";

/**
 * True iff `value` is representable at exactly `decimals` fractional digits.
 *
 * F2 correction: the tolerance must only absorb floating-point
 * REPRESENTATION noise (e.g. 80.29 stored as 8028.999999999999 once scaled),
 * not genuine extra precision. A fixed absolute tolerance like `1e-6` is
 * broad enough to also accept a value like `1e-10`, whose scaled form
 * (1e-8) sits well within 1e-6 of zero despite not being a 2-decimal number
 * at all — `fromDecimal` then silently rounds it to exactly 0. The
 * tolerance below instead scales with the magnitude being checked (a few
 * ULPs — `Number.EPSILON` — of the larger of the scaled value or 1), so it
 * shrinks toward zero exactly where representation noise shrinks toward
 * zero, and never masks a value that is genuinely off an integer cent by a
 * humanly meaningful amount.
 */
function isFiniteWithDecimals(value: unknown, decimals: number): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const scale = 10 ** decimals;
  const scaled = value * scale;
  const tolerance = Math.max(Math.abs(scaled), 1) * Number.EPSILON * 8;
  return Math.abs(scaled - Math.round(scaled)) < tolerance;
}

/**
 * A valid assessment maximum must be positive, in range, representable at
 * `SCORE_DECIMALS`, AND still strictly positive once actually converted to
 * the engine's internal Rational — F2's explicit second guarantee. Given
 * the tightened tolerance above, no positive value should be able to
 * collapse to zero on conversion any more, but a divisor is exactly the
 * place to keep that invariant checked explicitly rather than assumed.
 */
function isValidMaxScore(value: unknown): value is number {
  if (!isFiniteWithDecimals(value, SCORE_DECIMALS)) return false;
  if (value <= 0 || value > MAX_SCORE) return false;
  return fromDecimal(value, SCORE_DECIMALS).num > 0n;
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * F4 correction: validates the request's SHAPE — every container the code
 * below iterates is actually an array, and every element it dereferences is
 * a non-null object — before any typed check reads a property or iterates.
 * `CalculationRequest` only binds compile-time callers; a caller passing
 * deserialized/untrusted data can still hand this function `null`
 * anywhere in the tree (a null request, a null policy, a null element in
 * an otherwise-fine array), which throws immediately on property access
 * rather than producing the documented failure outcome. This function
 * treats its input as effectively `unknown` regardless of the declared
 * parameter type, and is the only place in this file that does so — every
 * function below it can keep assuming its typed shape actually holds,
 * because this ran first.
 *
 * This only screens for shapes that would THROW (null/undefined containers
 * or elements, non-arrays where an array is iterated). A present-but-wrong
 * primitive (e.g. a numeric typeId, a string weight) does not throw on
 * property access in JavaScript, so those are left to the existing
 * semantic checks below, which already reject them without crashing.
 */
function checkRequestShape(request: unknown): { code: CalculationFailureCode; issues: CalculationIssue[] } | null {
  if (isNullish(request) || typeof request !== "object") {
    return { code: "invalid-policy", issues: [{ message: "The calculation request must be an object." }] };
  }
  const { policy, assessments, entries } = request as Record<string, unknown>;

  if (isNullish(policy) || typeof policy !== "object") {
    return { code: "invalid-policy", issues: [{ message: "policy must be an object." }] };
  }
  const typeWeights = (policy as Record<string, unknown>).typeWeights;
  if (Array.isArray(typeWeights) && typeWeights.some((typeWeight) => isNullish(typeWeight) || typeof typeWeight !== "object")) {
    return { code: "invalid-policy", issues: [{ message: "Each entry in policy.typeWeights must be an object." }] };
  }

  if (Array.isArray(assessments) && assessments.some((assessment) => isNullish(assessment) || typeof assessment !== "object")) {
    return { code: "invalid-assessment", issues: [{ message: "Each entry in assessments must be an object." }] };
  }

  if (!Array.isArray(entries)) {
    return { code: "invalid-entry", issues: [{ message: "entries must be an array." }] };
  }
  if (entries.some((entry) => isNullish(entry) || typeof entry !== "object")) {
    return { code: "invalid-entry", issues: [{ message: "Each entry in entries must be an object." }] };
  }

  return null;
}

function checkPolicy(policy: CalculationPolicy): { code: "unsupported-policy" | "invalid-policy"; issues: CalculationIssue[] } | null {
  if (policy.version !== POLICY_VERSION) {
    return {
      code: "unsupported-policy",
      issues: [{ message: `Unsupported calculation policy version "${String(policy.version)}"; this engine implements "${POLICY_VERSION}".` }],
    };
  }

  const unsupported: CalculationIssue[] = [];
  for (const [field, value] of [
    ["absentTreatment", policy.absentTreatment],
    ["exemptTreatment", policy.exemptTreatment],
    ["missingTreatment", policy.missingTreatment],
  ] as const) {
    if (value !== "block") {
      unsupported.push({ message: `Policy field "${field}" requests "${String(value)}", which this engine version does not implement (only "block" is supported).` });
    }
  }
  if (unsupported.length > 0) return { code: "unsupported-policy", issues: unsupported };

  const invalid: CalculationIssue[] = [];
  const aggregation: readonly WithinTypeAggregation[] = ["equal-weighted-percentage", "earned-points"];
  if (!aggregation.includes(policy.withinTypeAggregation)) {
    invalid.push({ message: `Unknown within-type aggregation "${String(policy.withinTypeAggregation)}".` });
  }
  if (!Array.isArray(policy.typeWeights) || policy.typeWeights.length === 0) {
    invalid.push({ message: "At least one assessment-type weight is required." });
  } else {
    const seen = new Set<string>();
    let total = 0;
    for (const typeWeight of policy.typeWeights) {
      if (!Number.isInteger(typeWeight.weight) || typeWeight.weight < 1 || typeWeight.weight > 100) {
        invalid.push({ message: `Type "${typeWeight.typeId}" weight must be a whole number between 1 and 100.`, typeId: typeWeight.typeId });
      } else {
        total += typeWeight.weight;
      }
      if (seen.has(typeWeight.typeId)) {
        invalid.push({ message: `Type "${typeWeight.typeId}" is listed more than once in the policy.`, typeId: typeWeight.typeId });
      }
      seen.add(typeWeight.typeId);
    }
    if (seen.size === policy.typeWeights.length && total !== 100) {
      invalid.push({ message: `Assessment-type weights must total exactly 100; got ${total}.` });
    }
  }
  return invalid.length > 0 ? { code: "invalid-policy", issues: invalid } : null;
}

function checkAssessments(assessments: readonly AssessmentDefinition[], policy: CalculationPolicy): CalculationIssue[] {
  const issues: CalculationIssue[] = [];
  if (!Array.isArray(assessments) || assessments.length === 0) {
    return [{ message: "At least one assessment is required." }];
  }
  const validTypeIds = new Set(policy.typeWeights.map((typeWeight) => typeWeight.typeId));
  const seen = new Set<string>();
  for (const assessment of assessments) {
    if (seen.has(assessment.id)) {
      issues.push({ message: `Duplicate assessment id "${assessment.id}".`, assessmentId: assessment.id });
    }
    seen.add(assessment.id);
    if (!validTypeIds.has(assessment.typeId)) {
      issues.push({ message: `Assessment "${assessment.id}" references type "${assessment.typeId}", which is not part of the policy.`, assessmentId: assessment.id, typeId: assessment.typeId });
    }
    if (!isValidMaxScore(assessment.maxScore)) {
      issues.push({ message: `Assessment "${assessment.id}" has an invalid maximum score; it must be finite, greater than zero, at most ${MAX_SCORE}, and use at most ${SCORE_DECIMALS} decimal places.`, assessmentId: assessment.id });
    }
  }
  return issues;
}

const VALID_ENTRY_STATUSES: ReadonlySet<string> = new Set(["scored", "absent", "exempt", "missing"]);

function checkEntries(assessments: readonly AssessmentDefinition[], entries: readonly AssessmentEntry[]): CalculationIssue[] {
  const issues: CalculationIssue[] = [];
  const byId = new Map(assessments.map((assessment) => [assessment.id, assessment]));
  const seen = new Set<string>();
  for (const entry of entries) {
    const assessment = byId.get(entry.assessmentId);
    if (!assessment) {
      issues.push({ message: `Entry references unknown assessment "${entry.assessmentId}".`, assessmentId: entry.assessmentId });
      continue;
    }
    if (seen.has(entry.assessmentId)) {
      issues.push({ message: `Duplicate entry for assessment "${entry.assessmentId}".`, assessmentId: entry.assessmentId });
    }
    seen.add(entry.assessmentId);
    if (!VALID_ENTRY_STATUSES.has(entry.status)) {
      issues.push({ message: `Entry for assessment "${entry.assessmentId}" has an unrecognized status "${String(entry.status)}".`, assessmentId: entry.assessmentId });
      continue;
    }
    if (entry.status === "scored") {
      if (!isFiniteWithDecimals(entry.score, SCORE_DECIMALS) || (entry.score as number) < 0 || (entry.score as number) > assessment.maxScore) {
        issues.push({ message: `Entry for assessment "${entry.assessmentId}" has an invalid score; it must be finite, from 0 to the assessment's maximum (${assessment.maxScore}), with at most ${SCORE_DECIMALS} decimal places.`, assessmentId: entry.assessmentId });
      }
    } else if (entry.score !== undefined) {
      issues.push({ message: `Entry for assessment "${entry.assessmentId}" is "${entry.status}" and must not include a score.`, assessmentId: entry.assessmentId });
    }
  }
  for (const assessment of assessments) {
    if (!seen.has(assessment.id)) {
      issues.push({ message: `No entry was supplied for assessment "${assessment.id}".`, assessmentId: assessment.id });
    }
  }
  return issues;
}

function checkCompleteness(assessments: readonly AssessmentDefinition[], policy: CalculationPolicy, entries: readonly AssessmentEntry[]): CalculationIssue[] {
  const issues: CalculationIssue[] = [];
  for (const entry of entries) {
    if (entry.status !== "scored") {
      issues.push({ message: `Assessment "${entry.assessmentId}" is "${entry.status}"; a final result cannot be produced until this is resolved.`, assessmentId: entry.assessmentId });
    }
  }
  for (const typeWeight of policy.typeWeights) {
    const count = assessments.filter((assessment) => assessment.typeId === typeWeight.typeId).length;
    if (count === 0) {
      issues.push({ message: `No assessments were supplied for weighted type "${typeWeight.typeId}" (weight ${typeWeight.weight}%); a final result cannot be produced.`, typeId: typeWeight.typeId });
    }
  }
  return issues;
}

function aggregateType(
  assessmentsOfType: readonly AssessmentDefinition[],
  scoreById: ReadonlyMap<string, number>,
  mode: WithinTypeAggregation,
): Rational {
  if (mode === "equal-weighted-percentage") {
    const percentages = assessmentsOfType.map((assessment) => {
      const score = scoreById.get(assessment.id)!;
      return multiply(divide(fromDecimal(score), fromDecimal(assessment.maxScore)), fromInt(100));
    });
    return divideByInt(sum(percentages), assessmentsOfType.length);
  }
  const earned = sum(assessmentsOfType.map((assessment) => fromDecimal(scoreById.get(assessment.id)!)));
  const possible = sum(assessmentsOfType.map((assessment) => fromDecimal(assessment.maxScore)));
  return multiply(divide(earned, possible), fromInt(100));
}

export function calculateWeightedResult(request: CalculationRequest): CalculationOutcome {
  const shapeProblem = checkRequestShape(request);
  if (shapeProblem) return { ok: false, code: shapeProblem.code, issues: shapeProblem.issues };

  const policyProblem = checkPolicy(request.policy);
  if (policyProblem) return { ok: false, code: policyProblem.code, issues: policyProblem.issues };

  const assessmentIssues = checkAssessments(request.assessments, request.policy);
  if (assessmentIssues.length > 0) return { ok: false, code: "invalid-assessment", issues: assessmentIssues };

  const entryIssues = checkEntries(request.assessments, request.entries);
  if (entryIssues.length > 0) return { ok: false, code: "invalid-entry", issues: entryIssues };

  const completenessIssues = checkCompleteness(request.assessments, request.policy, request.entries);
  if (completenessIssues.length > 0) return { ok: false, code: "incomplete", issues: completenessIssues };

  const scoreById = new Map(request.entries.map((entry) => [entry.assessmentId, entry.score as number]));

  // F3 rounding contract: `finalRational` accumulates each type's EXACT
  // (unrounded) weightedContribution, so finalPercentage below is rounded
  // once from the true aggregate. `percentage`/`weightedContribution` on
  // each pushed row are separately rounded from that same type's exact
  // values, purely for display — never fed back into finalRational, and
  // never derived from each other's rounded form. See the rounding
  // contract documented on `TypeContribution` in contract.ts: the displayed
  // rows are not guaranteed to sum to finalPercentage.
  const typeContributions: TypeContribution[] = [];
  let finalRational: Rational = ZERO;
  for (const typeWeight of request.policy.typeWeights) {
    const assessmentsOfType = request.assessments.filter((assessment) => assessment.typeId === typeWeight.typeId);
    const typePercentage = aggregateType(assessmentsOfType, scoreById, request.policy.withinTypeAggregation);
    const weightedContribution = divideByInt(multiply(typePercentage, fromInt(typeWeight.weight)), 100);
    finalRational = add(finalRational, weightedContribution);
    typeContributions.push({
      typeId: typeWeight.typeId,
      weight: typeWeight.weight,
      assessmentCount: assessmentsOfType.length,
      percentage: roundToCents(typePercentage),
      weightedContribution: roundToCents(weightedContribution),
    });
  }

  return {
    ok: true,
    result: {
      policyVersion: request.policy.version,
      calculationVersion: ENGINE_VERSION,
      finalPercentage: roundToCents(finalRational),
      typeContributions,
    },
  };
}
