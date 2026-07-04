import type { OrgPath } from "../auth/types";

/**
 * CONTRACT FOR MODULE #3 (org structure) — interface only in Vidya #2.
 *
 * Identity stores scope grants against opaque org identifiers before the
 * org-structure module exists. When #3 ships, its public service implements
 * this contract; the identity module then verifies org paths at
 * grant-creation time and can re-verify existing grants (rows created
 * before #3 carry verified=false — see ADR-0010). Until then, NO
 * implementation exists anywhere: grant creation records the operator's
 * identifiers verbatim and audits who supplied them.
 */
export interface OrgDirectory {
  /** Does this path name real, correctly-nested org units? */
  verifyOrgPath(path: OrgPath): Promise<{ readonly valid: boolean; readonly reason?: string }>;
  /** Does this subject (course) identifier exist? */
  verifySubjectId(subjectId: string): Promise<boolean>;
}
