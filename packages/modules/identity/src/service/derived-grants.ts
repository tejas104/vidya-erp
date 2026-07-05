import type { AuditLogger, OrgPath, Role } from "@vidya/platform";
import type { SessionManager } from "../core/contracts";
import type { StoredGrant, UsersRepo } from "../repo/users-repo";

/**
 * Derived grants (ADR-0015): the identity-side surface of the grant
 * propagation seam. The people module's teacher assignments are the source
 * of truth; each assignment materializes as exactly one grant tagged
 * source='derived' + sourceRef, created verified=true (its org identifiers
 * come from real people-module rows).
 *
 * Security invariants owned here:
 *  - every change invalidates the affected user's sessions (the #2 rule:
 *    authority never changes mid-session);
 *  - derivation may ADD a role membership (assigning someone as a subject
 *    teacher makes them a teacher) but never removes one — role removal
 *    stays an explicit admin act;
 *  - every change is audited with its sourceRef.
 */

/** Only the two classroom roles are derivable — never admin/principal/hod. */
export type DerivableRole = Extract<Role, "teacher" | "class_teacher">;

export interface DerivedGrantInput {
  readonly userId: string;
  readonly role: DerivableRole;
  readonly org: OrgPath;
  readonly subjectId?: string;
  /** Stable originating-record key, e.g. "people:assignment:<id>". */
  readonly sourceRef: string;
}

export interface DerivedGrantView {
  readonly sourceRef: string;
  readonly userId: string;
  readonly role: Role;
  readonly org: OrgPath;
  readonly subjectId?: string;
}

export interface DerivedGrantsApi {
  /** Idempotent: same input twice is a no-op. Returns whether anything changed. */
  upsert(input: DerivedGrantInput): Promise<{ changed: boolean; grantId: string }>;
  removeBySourceRef(sourceRef: string): Promise<boolean>;
  /** For reconciliation: every derived grant whose sourceRef starts with the prefix. */
  listBySourcePrefix(prefix: string): Promise<DerivedGrantView[]>;
}

function sameOrg(a: OrgPath, b: OrgPath): boolean {
  return (
    a.collegeId === b.collegeId &&
    a.departmentId === b.departmentId &&
    a.classId === b.classId &&
    a.sectionId === b.sectionId
  );
}

function matchesInput(existing: StoredGrant, input: DerivedGrantInput): boolean {
  return (
    existing.userId === input.userId &&
    existing.role === input.role &&
    existing.subjectId === input.subjectId &&
    sameOrg(existing.org, input.org)
  );
}

export class DerivedGrantsService implements DerivedGrantsApi {
  constructor(
    private readonly repo: UsersRepo,
    private readonly sessions: SessionManager,
    private readonly audit: AuditLogger,
  ) {}

  async upsert(input: DerivedGrantInput): Promise<{ changed: boolean; grantId: string }> {
    const existing = await this.repo.findGrantBySourceRef(input.sourceRef);
    if (existing !== null && matchesInput(existing, input)) {
      return { changed: false, grantId: existing.id };
    }
    if (existing !== null) {
      await this.repo.removeGrant(existing.userId, existing.id);
      if (existing.userId !== input.userId) {
        await this.sessions.invalidateAllForUser(existing.userId);
      }
    }
    await this.repo.addRole(input.userId, input.role, "derivation");
    const stored = await this.repo.addGrant(input.userId, {
      role: input.role,
      org: input.org,
      ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
      grantedBy: "derivation",
      source: "derived",
      sourceRef: input.sourceRef,
      verified: true,
    });
    await this.sessions.invalidateAllForUser(input.userId);
    await this.audit.record({
      module: "identity",
      action: "identity.grant-derived",
      actorType: "system",
      actorId: null,
      resourceType: "scope-grant",
      resourceId: stored.id,
      requestId: null,
      details: {
        sourceRef: input.sourceRef,
        userId: input.userId,
        role: input.role,
        org: input.org,
        ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
        ...(existing !== null ? { replacedGrantId: existing.id } : {}),
      },
    });
    return { changed: true, grantId: stored.id };
  }

  async removeBySourceRef(sourceRef: string): Promise<boolean> {
    const existing = await this.repo.findGrantBySourceRef(sourceRef);
    if (existing === null) {
      return false;
    }
    await this.repo.removeGrant(existing.userId, existing.id);
    await this.sessions.invalidateAllForUser(existing.userId);
    await this.audit.record({
      module: "identity",
      action: "identity.grant-derivation-removed",
      actorType: "system",
      actorId: null,
      resourceType: "scope-grant",
      resourceId: existing.id,
      requestId: null,
      details: { sourceRef, userId: existing.userId, role: existing.role },
    });
    return true;
  }

  async listBySourcePrefix(prefix: string): Promise<DerivedGrantView[]> {
    const rows = await this.repo.listGrantsBySourcePrefix(prefix);
    return rows.map((row) => ({
      sourceRef: row.sourceRef ?? "",
      userId: row.userId,
      role: row.role,
      org: row.org,
      ...(row.subjectId !== undefined ? { subjectId: row.subjectId } : {}),
    }));
  }
}
