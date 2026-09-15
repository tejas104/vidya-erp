/**
 * Weighted-result calculation contract (S01).
 *
 * A pure, versioned calculation of a student's final percentage for one
 * subject/term from per-assessment scores, assessment-type weights, and an
 * explicit within-type aggregation choice. This is the calculation
 * foundation only: no report-card assembly, publication, grading-band
 * lookup, persistence, or wiring into any handler happens here (see the
 * package README of this directory / S01 delivery notes for scope).
 *
 * Versioning: `POLICY_VERSION` identifies the shape/semantics this engine
 * accepts as policy input; `ENGINE_VERSION` identifies the arithmetic that
 * produced a `CalculationResult`. They are tracked separately so a future
 * engine revision (e.g. a new rounding rule) can be distinguished from a
 * policy-shape revision (e.g. a new within-type aggregation mode).
 */

/** The only policy shape this engine accepts. A mismatched `policy.version`
 * is rejected as `unsupported-policy` rather than guessed at. */
export const POLICY_VERSION = "school-weighted-result.policy.v1" as const;

/** The arithmetic/rounding contract that produced a `CalculationResult`. */
export const ENGINE_VERSION = "school-weighted-result.engine.v1" as const;

/** Matches the existing school-marks score convention (marks-contracts.ts):
 * up to two decimal places, capped at 9999.99. */
export const MAX_SCORE = 9999.99;
export const SCORE_DECIMALS = 2;

export type WithinTypeAggregation =
  /** Average of each assessment's own normalized percentage (score/max),
   * every assessment counted equally regardless of its maximum. */
  | "equal-weighted-percentage"
  /** Sum of earned points divided by sum of possible points across the
   * type's assessments. Differs from equal weighting when maxima differ. */
  | "earned-points";

/** Only "block" is implemented in v1: any absent/exempt/missing entry blocks
 * the final result. The literal type is intentionally narrow — a caller
 * cannot silently opt into "treat as zero" or "redistribute weight"
 * behavior that does not exist yet. Untrusted input is still checked at
 * runtime in calculate.ts, since this is only a compile-time guarantee. */
export type IncompleteTreatment = "block";

export interface AssessmentTypeWeight {
  readonly typeId: string;
  /** Whole percentage, 1-100. All weights in a policy must sum to exactly 100. */
  readonly weight: number;
}

export interface CalculationPolicy {
  readonly version: typeof POLICY_VERSION;
  readonly typeWeights: readonly AssessmentTypeWeight[];
  readonly withinTypeAggregation: WithinTypeAggregation;
  readonly absentTreatment: IncompleteTreatment;
  readonly exemptTreatment: IncompleteTreatment;
  readonly missingTreatment: IncompleteTreatment;
}

export interface AssessmentDefinition {
  readonly id: string;
  readonly typeId: string;
  /** Must be finite, > 0, at most two decimal places, at most MAX_SCORE. */
  readonly maxScore: number;
}

export type AssessmentEntryStatus = "scored" | "absent" | "exempt" | "missing";

export interface AssessmentEntry {
  readonly assessmentId: string;
  readonly status: AssessmentEntryStatus;
  /** Required if and only if status is "scored". 0 is a valid entered score
   * and is distinct from every non-"scored" status. */
  readonly score?: number;
}

export interface CalculationRequest {
  readonly policy: CalculationPolicy;
  readonly assessments: readonly AssessmentDefinition[];
  /** Exactly one entry per assessment in `assessments` (no omissions, no duplicates). */
  readonly entries: readonly AssessmentEntry[];
}

export interface TypeContribution {
  readonly typeId: string;
  readonly weight: number;
  readonly assessmentCount: number;
  /** This type's aggregated percentage (0-100), rounded to 2dp. */
  readonly percentage: number;
  /** percentage * weight / 100, rounded to 2dp. Sums to `finalPercentage`. */
  readonly weightedContribution: number;
}

export interface CalculationResult {
  readonly policyVersion: string;
  readonly calculationVersion: string;
  /** 0-100, rounded to 2dp — see rational.ts for the rounding rule. */
  readonly finalPercentage: number;
  readonly typeContributions: readonly TypeContribution[];
}

export type CalculationFailureCode =
  | "unsupported-policy"
  | "invalid-policy"
  | "invalid-assessment"
  | "invalid-entry"
  | "incomplete";

export interface CalculationIssue {
  readonly message: string;
  readonly assessmentId?: string;
  readonly typeId?: string;
}

export type CalculationOutcome =
  | { readonly ok: true; readonly result: CalculationResult }
  | { readonly ok: false; readonly code: CalculationFailureCode; readonly issues: readonly CalculationIssue[] };
