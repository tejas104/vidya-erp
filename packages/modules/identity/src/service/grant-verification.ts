import type { OrgDirectory } from "@vidya/platform";
import type { UsersRepo } from "../repo/users-repo";

export interface GrantVerificationResult {
  readonly verified: number;
  readonly unresolved: readonly { grantId: string; reason: string }[];
}

/**
 * Backfill for grants created before the org tree existed (#3): sweeps
 * verified=false grants and flips the ones whose OrgPath (and subject) now
 * resolve against the people module's OrgDirectory. Grants that do not
 * resolve are reported, never deleted — removing authority is a human
 * decision. Runs synchronously from the admin route (grant counts are
 * small); the route's pipeline audit records the run and its counts.
 */
export class GrantVerificationService {
  constructor(
    private readonly repo: UsersRepo,
    private readonly orgDirectory: () => OrgDirectory | null,
  ) {}

  /** Returns null when no OrgDirectory is wired (people module absent). */
  async verifyUnverified(): Promise<GrantVerificationResult | null> {
    const directory = this.orgDirectory();
    if (directory === null) {
      return null;
    }
    const unverified = await this.repo.listUnverifiedGrants();
    let verified = 0;
    const unresolved: { grantId: string; reason: string }[] = [];
    for (const grant of unverified) {
      const path = await directory.verifyOrgPath(grant.org);
      if (!path.valid) {
        unresolved.push({ grantId: grant.id, reason: path.reason ?? "org path does not resolve" });
        continue;
      }
      if (grant.subjectId !== undefined && !(await directory.verifySubjectId(grant.subjectId))) {
        unresolved.push({ grantId: grant.id, reason: `unknown subjectId "${grant.subjectId}"` });
        continue;
      }
      await this.repo.markGrantVerified(grant.id);
      verified += 1;
    }
    return { verified, unresolved };
  }
}
