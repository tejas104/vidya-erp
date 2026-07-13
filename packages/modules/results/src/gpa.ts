/**
 * GPA math — pure functions anchored by the plan's golden numbers
 * (docs/superpowers/plans/2026-07-13-erp-master-plan-v2.md, Phase 3 R1).
 * Band minimum is inclusive; rounding is half-away-from-zero to 2dp and
 * happens BEFORE banding (mean) and at the end (SGPA/CGPA).
 */

export interface Band {
  minPct: number;
  grade: string;
  points: number;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Mean of assessment percents, 2dp. Null for an empty list — never an invented zero. */
export function meanPct(pcts: readonly number[]): number | null {
  if (pcts.length === 0) return null;
  return round2(pcts.reduce((sum, pct) => sum + pct, 0) / pcts.length);
}

/** The band with the highest minPct ≤ pct (minimum inclusive). */
export function bandFor(bands: readonly Band[], pct: number): Band {
  let best: Band | null = null;
  for (const band of bands) {
    if (band.minPct <= pct && (best === null || band.minPct > best.minPct)) best = band;
  }
  // The contract guarantees a 0-anchored band, so pct ≥ 0 always lands.
  return best ?? { minPct: 0, grade: "F", points: 0 };
}

/** Σ(points×credits)/Σ(credits), 2dp. Null when no subjects (no marks at all). */
export function sgpa(subjects: readonly { points: number; credits: number }[]): number | null {
  const totalCredits = subjects.reduce((sum, subject) => sum + subject.credits, 0);
  if (totalCredits === 0) return null;
  return round2(subjects.reduce((sum, subject) => sum + subject.points * subject.credits, 0) / totalCredits);
}

/** Credit-weighted SGPA across published terms, 2dp. Null when no terms. */
export function cgpa(terms: readonly { sgpa: number; credits: number }[]): number | null {
  const totalCredits = terms.reduce((sum, term) => sum + term.credits, 0);
  if (totalCredits === 0) return null;
  return round2(terms.reduce((sum, term) => sum + term.sgpa * term.credits, 0) / totalCredits);
}
