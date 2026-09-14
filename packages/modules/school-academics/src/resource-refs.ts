import type { OrgPath, ResourceRef } from "@vidya/platform";
import type { SchTermRow } from "./db/schema";

/**
 * THE scope-integration surface of the school-academics module — one short file
 * so the security review reads one page (ADR-0017).
 *
 * A term is an ADMINISTRATIVE, NON-SUBJECT record: no subjectId, ever. Its
 * org position comes from the columns denormalized onto the row at creation
 * (never from caller input), so containment is decided by the shared
 * ScopeChecker with no cross-module lookup.
 */
export function termOrg(term: Pick<SchTermRow, "collegeId" | "departmentId">): OrgPath {
  return { collegeId: term.collegeId, departmentId: term.departmentId };
}

export function termRef(term: Pick<SchTermRow, "collegeId" | "departmentId">): ResourceRef {
  return { module: "school-academics", resourceType: "term", org: termOrg(term) };
}
