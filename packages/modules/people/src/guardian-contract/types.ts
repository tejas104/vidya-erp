/**
 * Guardian access — a PROPOSED authorization contract (S03).
 *
 * Types only. No implementation, no I/O, nothing exported here is wired
 * into `../index.ts` (the people module's public API) or into any handler,
 * route, or database table. This is a design artifact for identity-owner
 * review — see docs/architecture/guardian-access/README.md for the full
 * proposal these types encode, and open-decisions.md for what is
 * deliberately left undecided.
 *
 * Deliberately mirrors the shape of `packages/platform/src/auth/types.ts`
 * (`Principal` / `ResourceRef` / `ScopeChecker` / `ScopeDecision`) without
 * importing from it and without touching it: guardian access is a THIRD
 * authorization relation, alongside containment (`ScopeChecker`) and
 * audience-matching (`orgOverlaps`, ADR-0022) — not an extension of either.
 * See docs/architecture/guardian-access/boundaries.md.
 */

// ---------------------------------------------------------------------------
// Entities (proposed — see docs/architecture/guardian-access/entity-model.md)
// ---------------------------------------------------------------------------

export type GuardianAccountStatus = "invited" | "active" | "suspended" | "deactivated";

/** One row per real person acting as a guardian — see entity-model.md. */
export interface GuardianRecord {
  readonly id: string;
  /** See boundaries.md — deliberately NOT collegeId: siblings can attend
   * different colleges within one tenant. */
  readonly tenantId: string;
  /** Cross-module link to the identity user; null until activation. No
   * foreign key (Constitution rule 2), same convention as
   * ppl_teachers.identity_user_id. */
  readonly identityUserId: string | null;
  readonly fullName: string;
  /** A contact channel, never an identifier — see entity-model.md, "Shared
   * phone numbers do not merge identity." */
  readonly primaryPhone: string | null;
  readonly primaryEmail: string | null;
  readonly status: GuardianAccountStatus;
}

export type RelationshipType = "parent" | "legal-guardian" | "other-authorized-contact";

export type VerificationState = "unverified" | "self-attested" | "staff-verified";

export type RelationshipStatus = "pending" | "active" | "restricted" | "revoked" | "expired";

/** What a relationship's authority can cover — the categories a guardian
 * operation or a staff restriction is expressed in terms of. */
export type GuardianRecordCategory =
  | "attendance"
  | "marks"
  | "report-card"
  | "fees"
  | "notices"
  | "homework"
  | "timetable"
  | "guardian-relationship";

/** A staff-recorded limit narrowing an otherwise-active relationship —
 * never widening one. See entity-model.md, "GuardianRestriction." */
export interface GuardianRestriction {
  readonly category: GuardianRecordCategory | "all";
  readonly action: GuardianAccessAction | "all";
  readonly note: string;
  readonly recordedBy: string;
}

/** One (guardian, student) pair — see entity-model.md. */
export interface StudentGuardianRelationship {
  readonly id: string;
  readonly guardianId: string;
  /** Opaque cross-module reference to ppl_students.id — no foreign key. */
  readonly studentId: string;
  /** Institution scope for THIS relationship — see boundaries.md, §1-vs-2. */
  readonly collegeId: string;
  readonly relationshipType: RelationshipType;
  /** Informational routing only — never an authorization multiplier. A
   * primary contact is not automatically the only authorized guardian
   * (strategy §5.2, verbatim). */
  readonly isPrimaryContact: boolean;
  readonly verificationState: VerificationState;
  readonly status: RelationshipStatus;
  readonly grantedCategories: ReadonlySet<GuardianRecordCategory>;
  readonly restrictions: readonly GuardianRestriction[];
  readonly validFrom: string;
  readonly validUntil: string | null;
  /** Post-transfer/departure read-only wind-down window — distinct from
   * validUntil. See lifecycle.md, "Transfer and permitted historical access." */
  readonly historicalAccessUntil: string | null;
}

export type InvitationStatus = "pending" | "activated" | "expired" | "revoked";

/** The precursor to a StudentGuardianRelationship — see lifecycle.md. */
export interface GuardianInvitation {
  readonly id: string;
  readonly studentId: string;
  readonly collegeId: string;
  readonly intendedRelationshipType: RelationshipType;
  readonly contactMethod: "sms" | "email";
  readonly status: InvitationStatus;
  readonly expiresAt: string;
}

// ---------------------------------------------------------------------------
// The access-decision contract (proposed — mirrors ScopeChecker's shape)
// ---------------------------------------------------------------------------

export type GuardianAccessAction =
  | "read"
  | "acknowledge"
  | "submit-leave-request"
  | "export"
  | "bulk-read"
  | "direct-file-access"
  | "create-relationship"
  | "modify-own-relationship";

/** What a would-be report-card resource's publication state is, when the
 * category is "report-card" — the 5.6 lifecycle gate. Absent for every
 * other category. */
export type PublicationState = "draft" | "validated" | "approved" | "published" | "superseded" | "withdrawn";

/** How a calling module describes the guardian-facing record it wants
 * checked. Mirrors ResourceRef's shape and intent, but is keyed to a
 * specific student and tenant rather than an OrgPath, because guardian
 * authority is not an org-tree containment question — see boundaries.md. */
export interface GuardianResourceRef {
  readonly tenantId: string;
  readonly collegeId: string;
  readonly studentId: string;
  readonly category: GuardianRecordCategory;
  readonly publicationState?: PublicationState;
}

/**
 * The authenticated guardian, as the adapter needs to see them.
 *
 * `relationships` is deliberately a plain array PASSED IN, not fetched by
 * the adapter (the adapter must stay pure/sync/no-I/O, exactly like
 * ScopeChecker) — see open-decisions.md #2 for why this proposal recommends
 * a future caller build this array FRESH per request (not from a cached
 * session snapshot), so relationship revocation can take effect promptly
 * without forcing a full re-login the way a staff grant change does.
 *
 * `alsoHoldsStaffRole` is informational only, for the "guardian who also
 * holds a staff role" conformance cases — an adapter implementation must
 * NEVER branch on it. It exists so a case can assert "this fact was present
 * and still made no difference," not to give the adapter something to key
 * on.
 */
export interface GuardianPrincipal {
  readonly identityUserId: string;
  readonly tenantId: string;
  readonly relationships: readonly StudentGuardianRelationship[];
  readonly alsoHoldsStaffRole?: boolean;
}

export type GuardianDecisionReason =
  | "granted:active-relationship"
  | "denied:no-relationship"
  | "denied:relationship-pending"
  | "denied:relationship-revoked"
  | "denied:relationship-expired"
  | "denied:relationship-restricted"
  | "denied:category-not-granted"
  | "denied:cross-tenant"
  | "denied:cross-institution"
  | "denied:unpublished-content"
  | "denied:self-expansion-attempt"
  | "denied:export-not-permitted"
  | "denied:bulk-request-not-permitted"
  | "denied:direct-file-access-not-mediated"
  | "denied:action-not-in-matrix";

/** Mirrors ScopeDecision's shape. */
export interface GuardianAccessDecision {
  readonly granted: boolean;
  readonly reason: GuardianDecisionReason;
  /** Which relationship (if any) justified a grant — observability, mirrors
   * ScopeDecision.matchedGrant. */
  readonly matchedRelationshipId?: string;
}

/**
 * THE GUARDIAN-ACCESS SEAM — proposed, additive, parallel to ScopeChecker.
 *
 * For the future authorized implementation (identity-owner reviewed, per
 * ADR-0012's pattern — this file proposes the shape, never the body).
 * Required properties, matching ScopeChecker's (ADR-0010):
 *  - pure, synchronous, deterministic, no I/O;
 *  - deny-by-default: no matching, unrestricted, active relationship whose
 *    collegeId/tenantId/category all match ⇒ { granted: false, reason };
 *  - never reads or writes Principal, ScopeGrant, or ScopeChecker state.
 */
export interface GuardianAccessAdapter {
  check(principal: GuardianPrincipal, action: GuardianAccessAction, resource: GuardianResourceRef): GuardianAccessDecision;
}

// ---------------------------------------------------------------------------
// Invitation validation (proposed — a separate, smaller decision shape)
// ---------------------------------------------------------------------------

export type InvitationOutcomeReason = "activated" | "denied:expired" | "denied:already-activated" | "denied:revoked";

export interface InvitationActivationDecision {
  readonly ok: boolean;
  readonly reason: InvitationOutcomeReason;
}

export interface InvitationAdapter {
  /** Pure: given an invitation's current recorded state and the instant of
   * the attempt, decide whether activation may proceed. Never mutates the
   * invitation itself — that is the future implementation's job. */
  checkActivation(invitation: GuardianInvitation, attemptedAt: string): InvitationActivationDecision;
}
