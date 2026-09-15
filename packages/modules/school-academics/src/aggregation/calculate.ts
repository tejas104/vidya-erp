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
  type CalculationIssue,
  type CalculationOutcome,
  type CalculationPolicy,
  type CalculationRequest,
  type TypeContribution,
  type WithinTypeAggregation,
} from "./contract";
import { add, divide, divideByInt, fromDecimal, fromInt, multiply, roundToCents, sum, ZERO, type Rational } from "./rational";

function isFiniteWithDecimals(value: unknown, decimals: number): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const scale = 10 ** decimals;
  return Math.abs(value * scale - Math.round(value * scale)) < 1e-6;
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
    if (!isFiniteWithDecimals(assessment.maxScore, SCORE_DECIMALS) || assessment.maxScore <= 0 || assessment.maxScore > MAX_SCORE) {
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
  const policyProblem = checkPolicy(request.policy);
  if (policyProblem) return { ok: false, code: policyProblem.code, issues: policyProblem.issues };

  const assessmentIssues = checkAssessments(request.assessments, request.policy);
  if (assessmentIssues.length > 0) return { ok: false, code: "invalid-assessment", issues: assessmentIssues };

  const entryIssues = checkEntries(request.assessments, request.entries);
  if (entryIssues.length > 0) return { ok: false, code: "invalid-entry", issues: entryIssues };

  const completenessIssues = checkCompleteness(request.assessments, request.policy, request.entries);
  if (completenessIssues.length > 0) return { ok: false, code: "incomplete", issues: completenessIssues };

  const scoreById = new Map(request.entries.map((entry) => [entry.assessmentId, entry.score as number]));

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
