import type {
  GuardianAccessAction,
  GuardianAccessAdapter,
  GuardianAccessDecision,
  GuardianPrincipal,
  GuardianResourceRef,
  GuardianRestriction,
  InvitationAdapter,
  StudentGuardianRelationship,
} from "./types";

/**
 * The guardian access adapter — the decision function for ADR-0027.
 *
 * Pure, synchronous, deterministic, no I/O, deny-by-default: the same
 * properties ADR-0010 requires of `ScopeChecker`, which this deliberately
 * mirrors without importing from or modifying. Guardian access is a THIRD
 * authorization relation alongside containment and audience-matching — see
 * docs/architecture/guardian-access/boundaries.md.
 *
 * ADR-0027 is ratified. GuardianService calls this adapter after loading the
 * current relationships for each authenticated guardian request. The S03
 * contract cases run against this implementation.
 *
 * The relationship list arrives as an input rather than being fetched here
 * (ADR-0027 Decision 2: relationships are read fresh per request, never from
 * a session snapshot, so a revocation takes effect without a forced logout).
 * That is what keeps this function pure.
 */

/** Actions a guardian may never perform, whatever their relationships say.
 *  Refused before any relationship is examined, so the refusal cannot leak
 *  whether a relationship exists. */
const CATEGORICALLY_REFUSED: Readonly<
  Partial<Record<GuardianAccessAction, GuardianAccessDecision["reason"]>>
> = {
  export: "denied:export-not-permitted",
  "bulk-read": "denied:bulk-request-not-permitted",
  "create-relationship": "denied:self-expansion-attempt",
  "modify-own-relationship": "denied:self-expansion-attempt",
};

/**
 * The actions a relationship can justify. Anything outside this set and
 * outside CATEGORICALLY_REFUSED is unknown to the matrix and denied.
 *
 * `direct-file-access` belongs HERE, not among the refusals. The rule it
 * carries is not "guardians may not open files" — it is that a file fetch is
 * re-authorized on every request, so a deep link a guardian kept from last
 * term stops working the moment the relationship is revoked. It therefore
 * runs the identical relationship check that `read` does.
 *
 * The declared reason `denied:direct-file-access-not-mediated` is
 * consequently NOT reachable from this function, and no conformance case
 * exercises it. It describes a file served without passing through this
 * check at all — a storage-layer or route-wiring failure, which this pure
 * decision function cannot observe and must not pretend to rule out.
 */
const RELATIONSHIP_ACTIONS: ReadonlySet<GuardianAccessAction> = new Set([
  "read",
  "acknowledge",
  "submit-leave-request",
  "direct-file-access",
]);

function deny(reason: GuardianAccessDecision["reason"]): GuardianAccessDecision {
  return { granted: false, reason };
}

/** A restriction narrows an otherwise-active relationship; it never widens
 *  one, and "all" matches every category or action. */
function restricts(
  restriction: GuardianRestriction,
  action: GuardianAccessAction,
  resource: GuardianResourceRef,
): boolean {
  const categoryHits = restriction.category === "all" || restriction.category === resource.category;
  const actionHits = restriction.action === "all" || restriction.action === action;
  return categoryHits && actionHits;
}

/**
 * The per-relationship verdict. Separated so the caller can try every
 * relationship a guardian holds and report the most specific refusal, rather
 * than letting one unrelated row mask a real grant.
 */
function evaluate(
  relationship: StudentGuardianRelationship,
  action: GuardianAccessAction,
  resource: GuardianResourceRef,
): GuardianAccessDecision {
  // A relationship is scoped to ONE institution. A guardian with a child in
  // another college of the same tenant does not thereby reach this one.
  if (relationship.collegeId !== resource.collegeId) {
    return deny("denied:cross-institution");
  }

  switch (relationship.status) {
    case "pending":
      return deny("denied:relationship-pending");
    case "revoked":
      return deny("denied:relationship-revoked");
    case "expired":
      return deny("denied:relationship-expired");
    case "restricted":
    case "active":
      break;
  }

  if (!relationship.grantedCategories.has(resource.category)) {
    return deny("denied:category-not-granted");
  }

  for (const restriction of relationship.restrictions) {
    if (restricts(restriction, action, resource)) {
      return deny("denied:relationship-restricted");
    }
  }

  // A report card is only a guardian-visible record once the school has
  // published it. Draft, approved-but-unpublished, superseded and withdrawn
  // states are all school-internal — a guardian must never see a figure the
  // school has not stood behind, and must not keep seeing a withdrawn one.
  if (resource.category === "report-card" && resource.publicationState !== "published") {
    return deny("denied:unpublished-content");
  }

  return { granted: true, reason: "granted:active-relationship", matchedRelationshipId: relationship.id };
}

class RelationshipGuardianAccessAdapter implements GuardianAccessAdapter {
  check(
    principal: GuardianPrincipal,
    action: GuardianAccessAction,
    resource: GuardianResourceRef,
  ): GuardianAccessDecision {
    // Tenant first: a cross-tenant request is refused before anything about
    // this tenant's data — including whether a pupil exists — is consulted.
    if (principal.tenantId !== resource.tenantId) {
      return deny("denied:cross-tenant");
    }

    const refused = CATEGORICALLY_REFUSED[action];
    if (refused !== undefined) {
      return deny(refused);
    }
    if (!RELATIONSHIP_ACTIONS.has(action)) {
      return deny("denied:action-not-in-matrix");
    }

    // `alsoHoldsStaffRole` is deliberately NOT read. A guardian who also
    // teaches reaches their own child through this relation and their pupils
    // through ScopeChecker; the two never add up.
    const forStudent = principal.relationships.filter(
      (candidate) => candidate.studentId === resource.studentId,
    );
    if (forStudent.length === 0) {
      return deny("denied:no-relationship");
    }

    // Independently authorized: any one qualifying relationship grants. Two
    // guardians of one child, and one guardian of two children, both fall out
    // of this without a special case.
    let mostSpecific: GuardianAccessDecision | null = null;
    for (const relationship of forStudent) {
      const decision = evaluate(relationship, action, resource);
      if (decision.granted) return decision;
      // Keep the FIRST refusal: cases pin the reason a single relationship
      // produces, and a later unrelated row must not overwrite it.
      mostSpecific ??= decision;
    }
    return mostSpecific ?? deny("denied:no-relationship");
  }
}

export function createGuardianAccessAdapter(): GuardianAccessAdapter {
  return new RelationshipGuardianAccessAdapter();
}

/**
 * Invitation activation. Equally pure: it decides against the invitation's
 * recorded state and the instant of the attempt, and never mutates the
 * invitation — persisting the outcome is the caller's job.
 */
class RecordedStateInvitationAdapter implements InvitationAdapter {
  checkActivation(
    invitation: Parameters<InvitationAdapter["checkActivation"]>[0],
    attemptedAt: string,
  ) {
    switch (invitation.status) {
      case "activated":
        return { ok: false as const, reason: "denied:already-activated" as const };
      case "revoked":
        return { ok: false as const, reason: "denied:revoked" as const };
      case "expired":
        return { ok: false as const, reason: "denied:expired" as const };
      case "pending":
        break;
    }
    // Compared as instants, not strings: the stored values are ISO-8601 but
    // need not share a timezone offset, and a lexical compare would be wrong
    // the moment one of them did not.
    return Date.parse(attemptedAt) > Date.parse(invitation.expiresAt)
      ? { ok: false as const, reason: "denied:expired" as const }
      : { ok: true as const, reason: "activated" as const };
  }
}

export function createInvitationAdapter(): InvitationAdapter {
  return new RecordedStateInvitationAdapter();
}
