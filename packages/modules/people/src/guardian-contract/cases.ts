/**
 * Guardian access — machine-readable conformance cases (S03, PROPOSED).
 *
 * This file is DATA plus a test-harness FACTORY, mirroring
 * `packages/modules/identity/src/core/conformance/scope-checker.ts` (the
 * ADR-0010 matrix in executable form). `describeGuardianAccessConformance`
 * below is exported but never invoked anywhere in this codebase — exactly
 * like `describeScopeCheckerConformance` is only ever invoked from an
 * IMPLEMENTATION's own test file, never from within the conformance file
 * itself. There is no implementation here to invoke it against.
 *
 * `cases.test.ts` in this directory validates this file's DATA — shape and
 * required-scenario coverage — and never calls `describeGuardianAccessConformance`.
 * That is the deliberate split: this file is the specification; running it
 * against a real GuardianAccessAdapter (proving enforcement) is a separate,
 * later, human-reviewed step. See docs/architecture/guardian-access/README.md,
 * "What this is not."
 */
import { describe, expect, it } from "vitest";
import type {
  GuardianAccessAction,
  GuardianAccessAdapter,
  GuardianAccessDecision,
  GuardianPrincipal,
  GuardianRecordCategory,
  GuardianResourceRef,
  InvitationActivationDecision,
  InvitationAdapter,
  StudentGuardianRelationship,
} from "./types";

// --- Fixture builders (mirrors scope-checker.ts's grant()/caller() style) --

const TENANT = "tnt-1";
const OTHER_TENANT = "tnt-2";
const COLLEGE = "col-1";
const OTHER_COLLEGE = "col-2"; // same tenant as COLLEGE
const STUDENT_A = "stu-a"; // guardian's own child
const STUDENT_B = "stu-b"; // guardian's sibling child
const STUDENT_UNLINKED = "stu-unlinked"; // no relationship exists at all

const ALL_CATEGORIES: readonly GuardianRecordCategory[] = [
  "attendance",
  "marks",
  "report-card",
  "fees",
  "notices",
  "homework",
  "timetable",
  "guardian-relationship",
];

function relationship(overrides: Partial<StudentGuardianRelationship> = {}): StudentGuardianRelationship {
  return {
    id: "sgr-default",
    guardianId: "grd-default",
    studentId: STUDENT_A,
    collegeId: COLLEGE,
    relationshipType: "parent",
    isPrimaryContact: true,
    verificationState: "self-attested",
    status: "active",
    grantedCategories: new Set(ALL_CATEGORIES),
    restrictions: [],
    validFrom: "2026-01-01",
    validUntil: null,
    historicalAccessUntil: null,
    ...overrides,
  };
}

function principal(overrides: Partial<GuardianPrincipal> & { relationships: readonly StudentGuardianRelationship[] }): GuardianPrincipal {
  return {
    identityUserId: "usr-guardian-1",
    tenantId: TENANT,
    ...overrides,
  };
}

function resource(overrides: Partial<GuardianResourceRef> = {}): GuardianResourceRef {
  return {
    tenantId: TENANT,
    collegeId: COLLEGE,
    studentId: STUDENT_A,
    category: "attendance",
    ...overrides,
  };
}

/**
 * The 13 REQUIRED scenario categories from the S03 assignment, plus the
 * strategy-§5.2/§5.3/§8.4 acceptance criteria this proposal folds in. The
 * coverage test in cases.test.ts asserts every tag below is exercised by at
 * least one case — a case's `tag` is what that test greps for, not its
 * free-text `name`.
 */
export type RequiredScenarioTag =
  | "two-guardians-one-child"
  | "guardian-siblings"
  | "shared-phone-no-identity-merge"
  | "guardian-also-staff"
  | "cross-tenant"
  | "cross-institution"
  | "revocation-during-active-session"
  | "changed-contact-no-silent-transfer"
  | "transfer-and-historical-access"
  | "staff-recorded-restriction"
  | "direct-file-export-bulk-deep-link"
  | "unpublished-or-withdrawn-content"
  | "self-expansion-attempt"
  | "child-selector-switch"
  | "unlinked-child";

export interface GuardianCase {
  readonly name: string;
  readonly tag: RequiredScenarioTag;
  readonly principal: GuardianPrincipal;
  readonly action: GuardianAccessAction;
  readonly resource: GuardianResourceRef;
  readonly expected: GuardianAccessDecision;
}

export const GUARDIAN_ACCESS_CASES: readonly GuardianCase[] = [
  // --- two guardians linked to one child ------------------------------------
  {
    name: "first guardian reads their child's attendance",
    tag: "two-guardians-one-child",
    principal: principal({ identityUserId: "usr-parent-1", relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "read",
    resource: resource(),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-1" },
  },
  {
    name: "second, unrelated guardian ALSO reads the same child's attendance — both are independently authorized",
    tag: "two-guardians-one-child",
    principal: principal({ identityUserId: "usr-parent-2", relationships: [relationship({ id: "sgr-2", guardianId: "grd-2" })] }),
    action: "read",
    resource: resource(),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-2" },
  },
  {
    name: "a non-primary-contact guardian is authorized identically to the primary contact",
    tag: "two-guardians-one-child",
    principal: principal({ identityUserId: "usr-parent-2", relationships: [relationship({ id: "sgr-2b", guardianId: "grd-2", isPrimaryContact: false })] }),
    action: "read",
    resource: resource(),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-2b" },
  },

  // --- one guardian linked to siblings ---------------------------------------
  {
    name: "guardian reads sibling A's marks",
    tag: "guardian-siblings",
    principal: principal({
      relationships: [
        relationship({ id: "sgr-a", guardianId: "grd-1", studentId: STUDENT_A }),
        relationship({ id: "sgr-b", guardianId: "grd-1", studentId: STUDENT_B }),
      ],
    }),
    action: "read",
    resource: resource({ studentId: STUDENT_A, category: "marks", publicationState: "published" }),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-a" },
  },
  {
    name: "the SAME guardian reads sibling B's marks (a distinct relationship, checked independently)",
    tag: "guardian-siblings",
    principal: principal({
      relationships: [
        relationship({ id: "sgr-a", guardianId: "grd-1", studentId: STUDENT_A }),
        relationship({ id: "sgr-b", guardianId: "grd-1", studentId: STUDENT_B }),
      ],
    }),
    action: "read",
    resource: resource({ studentId: STUDENT_B, category: "marks", publicationState: "published" }),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-b" },
  },
  {
    name: "having a relationship to sibling A does not grant access to a THIRD, unrelated child",
    tag: "guardian-siblings",
    principal: principal({
      relationships: [
        relationship({ id: "sgr-a", guardianId: "grd-1", studentId: STUDENT_A }),
        relationship({ id: "sgr-b", guardianId: "grd-1", studentId: STUDENT_B }),
      ],
    }),
    action: "read",
    resource: resource({ studentId: STUDENT_UNLINKED }),
    expected: { granted: false, reason: "denied:no-relationship" },
  },

  // --- child selector: switching between linked children (§5.2 acceptance) --
  {
    name: "child-selector switch: the same request shape, re-targeted at the other linked child, is checked independently and still granted",
    tag: "child-selector-switch",
    principal: principal({
      relationships: [
        relationship({ id: "sgr-a", guardianId: "grd-1", studentId: STUDENT_A }),
        relationship({ id: "sgr-b", guardianId: "grd-1", studentId: STUDENT_B }),
      ],
    }),
    action: "read",
    resource: resource({ studentId: STUDENT_B, category: "timetable" }),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-b" },
  },

  // --- unlinked child (§5.2 acceptance: "an unlinked child remains inaccessible") --
  {
    name: "no relationship at all to the requested child: denied regardless of action",
    tag: "unlinked-child",
    principal: principal({ relationships: [] }),
    action: "read",
    resource: resource({ studentId: STUDENT_UNLINKED }),
    expected: { granted: false, reason: "denied:no-relationship" },
  },

  // --- shared phone numbers without automatic identity merging --------------
  // Nothing in GuardianPrincipal/GuardianResourceRef carries a phone number
  // at all (see types.ts) — the decision surface structurally cannot key on
  // it. These cases pin that two guardianIds are independently evaluated
  // even when (per entity-model.md) their GuardianRecords might coincidentally
  // share a primaryPhone: identity here is the relationship id, never contact info.
  {
    name: "two distinct guardianIds (documented as sharing a phone number at the record level) are authorized independently, never merged",
    tag: "shared-phone-no-identity-merge",
    principal: principal({ identityUserId: "usr-parent-1", relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "read",
    resource: resource(),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-1" },
  },
  {
    name: "the second guardianId's own (empty) relationship set is NOT inflated by the first guardian's relationship, despite a shared phone",
    tag: "shared-phone-no-identity-merge",
    principal: principal({ identityUserId: "usr-parent-3-shares-phone-with-parent-1", relationships: [] }),
    action: "read",
    resource: resource(),
    expected: { granted: false, reason: "denied:no-relationship" },
  },

  // --- changed contact details do not silently transfer child access --------
  // Same structural argument as above: contact fields are absent from the
  // decision surface, so a GuardianRecord's phone/email update cannot be
  // expressed as an input to this adapter at all — only `relationships`
  // (keyed by guardianId, never by contact value) can grant anything.
  {
    name: "a guardian's decision depends only on their own relationships, never on any contact-detail value",
    tag: "changed-contact-no-silent-transfer",
    principal: principal({ identityUserId: "usr-parent-1", relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "read",
    resource: resource(),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-1" },
  },

  // --- a guardian who also holds a staff role --------------------------------
  {
    name: "a guardian who is also a teacher gets the same decision as any other guardian for their own child",
    tag: "guardian-also-staff",
    principal: principal({
      identityUserId: "usr-teacher-parent",
      alsoHoldsStaffRole: true,
      relationships: [relationship({ id: "sgr-staff-parent", guardianId: "grd-staff-parent" })],
    }),
    action: "read",
    resource: resource(),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-staff-parent" },
  },
  {
    name: "holding a staff role grants NOTHING extra: the same teacher-parent still cannot read a child they have no relationship to",
    tag: "guardian-also-staff",
    principal: principal({
      identityUserId: "usr-teacher-parent",
      alsoHoldsStaffRole: true,
      relationships: [relationship({ id: "sgr-staff-parent", guardianId: "grd-staff-parent" })],
    }),
    action: "read",
    resource: resource({ studentId: STUDENT_UNLINKED }),
    expected: { granted: false, reason: "denied:no-relationship" },
  },

  // --- cross-tenant and cross-institution requests ---------------------------
  {
    name: "cross-tenant: a session from an entirely different deployment/tenant is denied before any relationship is even consulted",
    tag: "cross-tenant",
    principal: principal({ tenantId: OTHER_TENANT, relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "read",
    resource: resource({ tenantId: TENANT }),
    expected: { granted: false, reason: "denied:cross-tenant" },
  },
  {
    name: "cross-institution: same tenant, but no relationship covers the requested college",
    tag: "cross-institution",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1", collegeId: COLLEGE })] }),
    action: "read",
    resource: resource({ collegeId: OTHER_COLLEGE }),
    expected: { granted: false, reason: "denied:cross-institution" },
  },
  {
    name: "cross-institution is distinguishable from cross-tenant in the decision reason (an incident review must tell them apart)",
    tag: "cross-institution",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1", collegeId: COLLEGE })] }),
    action: "read",
    resource: resource({ collegeId: OTHER_COLLEGE, tenantId: TENANT }),
    expected: { granted: false, reason: "denied:cross-institution" },
  },

  // --- revocation while a session remains active -----------------------------
  {
    name: "a revoked relationship denies access even though the principal's session (and other relationships) remain otherwise valid",
    tag: "revocation-during-active-session",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1", status: "revoked" })] }),
    action: "read",
    resource: resource(),
    expected: { granted: false, reason: "denied:relationship-revoked" },
  },
  {
    name: "revoking access to child A does not touch an unrelated, still-active relationship to child B in the SAME principal/session",
    tag: "revocation-during-active-session",
    principal: principal({
      relationships: [
        relationship({ id: "sgr-a-revoked", guardianId: "grd-1", studentId: STUDENT_A, status: "revoked" }),
        relationship({ id: "sgr-b-active", guardianId: "grd-1", studentId: STUDENT_B, status: "active" }),
      ],
    }),
    action: "read",
    resource: resource({ studentId: STUDENT_B }),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-b-active" },
  },
  {
    name: "a pending (not yet verified) relationship does not yet grant access",
    tag: "revocation-during-active-session",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1", status: "pending" })] }),
    action: "read",
    resource: resource(),
    expected: { granted: false, reason: "denied:relationship-pending" },
  },
  {
    name: "an expired relationship denies access",
    tag: "revocation-during-active-session",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1", status: "expired" })] }),
    action: "read",
    resource: resource(),
    expected: { granted: false, reason: "denied:relationship-expired" },
  },

  // --- transfer and permitted historical access ------------------------------
  {
    name: "after transfer, a relationship past validUntil but still inside historicalAccessUntil permits reading a record from BEFORE the transfer",
    tag: "transfer-and-historical-access",
    principal: principal({
      relationships: [
        relationship({ id: "sgr-1", guardianId: "grd-1", status: "active", validFrom: "2025-06-01", validUntil: "2026-03-31", historicalAccessUntil: "2026-09-30" }),
      ],
    }),
    action: "read",
    resource: resource({ category: "report-card", publicationState: "published" }),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-1" },
  },
  {
    name: "once BOTH validUntil and historicalAccessUntil have passed, the relationship is expired, not merely wound down",
    tag: "transfer-and-historical-access",
    principal: principal({
      relationships: [
        relationship({ id: "sgr-1", guardianId: "grd-1", status: "expired", validFrom: "2024-06-01", validUntil: "2025-03-31", historicalAccessUntil: "2025-09-30" }),
      ],
    }),
    action: "read",
    resource: resource({ category: "report-card", publicationState: "published" }),
    expected: { granted: false, reason: "denied:relationship-expired" },
  },

  // --- staff-recorded relationship restrictions -------------------------------
  {
    name: "a restriction on 'fees' does not affect reading 'attendance' on the same, otherwise-active relationship",
    tag: "staff-recorded-restriction",
    principal: principal({
      relationships: [
        relationship({
          id: "sgr-1",
          guardianId: "grd-1",
          status: "restricted",
          restrictions: [{ category: "fees", action: "read", note: "custody order on file", recordedBy: "usr-admin-1" }],
        }),
      ],
    }),
    action: "read",
    resource: resource({ category: "attendance" }),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-1" },
  },
  {
    name: "the SAME restricted relationship denies the specifically restricted category",
    tag: "staff-recorded-restriction",
    principal: principal({
      relationships: [
        relationship({
          id: "sgr-1",
          guardianId: "grd-1",
          status: "restricted",
          restrictions: [{ category: "fees", action: "read", note: "custody order on file", recordedBy: "usr-admin-1" }],
        }),
      ],
    }),
    action: "read",
    resource: resource({ category: "fees" }),
    expected: { granted: false, reason: "denied:relationship-restricted" },
  },
  {
    name: "a category not in grantedCategories at all (independent of any restriction) is denied",
    tag: "staff-recorded-restriction",
    principal: principal({
      relationships: [relationship({ id: "sgr-1", guardianId: "grd-1", relationshipType: "other-authorized-contact", grantedCategories: new Set(["notices"]) })],
    }),
    action: "read",
    resource: resource({ category: "marks", publicationState: "published" }),
    expected: { granted: false, reason: "denied:category-not-granted" },
  },

  // --- direct file access, exports, bulk requests, and notification deep links --
  {
    name: "export is never granted to a guardian, even with a fully active, unrestricted relationship",
    tag: "direct-file-export-bulk-deep-link",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "export",
    resource: resource(),
    expected: { granted: false, reason: "denied:export-not-permitted" },
  },
  {
    name: "a bulk (multi-student) read is never granted, even when every implied child is individually linked",
    tag: "direct-file-export-bulk-deep-link",
    principal: principal({
      relationships: [
        relationship({ id: "sgr-a", guardianId: "grd-1", studentId: STUDENT_A }),
        relationship({ id: "sgr-b", guardianId: "grd-1", studentId: STUDENT_B }),
      ],
    }),
    action: "bulk-read",
    resource: resource({ studentId: STUDENT_A }),
    expected: { granted: false, reason: "denied:bulk-request-not-permitted" },
  },
  {
    name: "direct file access re-runs the full check (mediated fetch), and is denied once the relationship is revoked — a stale deep link is not a standing grant",
    tag: "direct-file-export-bulk-deep-link",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1", status: "revoked" })] }),
    action: "direct-file-access",
    resource: resource({ category: "report-card", publicationState: "published" }),
    expected: { granted: false, reason: "denied:relationship-revoked" },
  },
  {
    name: "direct file access is granted only through the same mediated check as read — never a bare standing grant",
    tag: "direct-file-export-bulk-deep-link",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "direct-file-access",
    resource: resource({ category: "report-card", publicationState: "published" }),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-1" },
  },

  // --- unpublished reports and withdrawn content (§5.6 lifecycle gate) -------
  {
    name: "a draft report card is denied even to an active, unrestricted guardian relationship",
    tag: "unpublished-or-withdrawn-content",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "read",
    resource: resource({ category: "report-card", publicationState: "draft" }),
    expected: { granted: false, reason: "denied:unpublished-content" },
  },
  {
    name: "an approved-but-not-yet-published report card is still denied",
    tag: "unpublished-or-withdrawn-content",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "read",
    resource: resource({ category: "report-card", publicationState: "approved" }),
    expected: { granted: false, reason: "denied:unpublished-content" },
  },
  {
    name: "a withdrawn report card reverts to denied for the withdrawn artifact itself",
    tag: "unpublished-or-withdrawn-content",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "read",
    resource: resource({ category: "report-card", publicationState: "withdrawn" }),
    expected: { granted: false, reason: "denied:unpublished-content" },
  },
  {
    name: "a published report card is the one state that is granted",
    tag: "unpublished-or-withdrawn-content",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "read",
    resource: resource({ category: "report-card", publicationState: "published" }),
    expected: { granted: true, reason: "granted:active-relationship", matchedRelationshipId: "sgr-1" },
  },

  // --- attempts to create or expand one's own guardian relationship -----------
  {
    name: "a guardian attempting to CREATE a new relationship for themselves is denied outright, regardless of their existing relationships",
    tag: "self-expansion-attempt",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1" })] }),
    action: "create-relationship",
    resource: resource({ studentId: STUDENT_UNLINKED }),
    expected: { granted: false, reason: "denied:self-expansion-attempt" },
  },
  {
    name: "a guardian attempting to MODIFY their own relationship (e.g. lift a restriction, extend validUntil) is denied outright",
    tag: "self-expansion-attempt",
    principal: principal({
      relationships: [relationship({ id: "sgr-1", guardianId: "grd-1", status: "restricted", restrictions: [{ category: "fees", action: "read", note: "custody order", recordedBy: "usr-admin-1" }] })],
    }),
    action: "modify-own-relationship",
    resource: resource(),
    expected: { granted: false, reason: "denied:self-expansion-attempt" },
  },
  {
    name: "§8.4 probe: a guardian substitutes a DIFFERENT studentId than any of their own relationships name — denied, not merely 'no match found by accident'",
    tag: "self-expansion-attempt",
    principal: principal({ relationships: [relationship({ id: "sgr-1", guardianId: "grd-1", studentId: STUDENT_A })] }),
    action: "read",
    resource: resource({ studentId: STUDENT_UNLINKED }),
    expected: { granted: false, reason: "denied:no-relationship" },
  },

  // --- deny-by-default and reason hygiene --------------------------------------
  {
    name: "deny-by-default: zero relationships, zero access, for any category",
    tag: "unlinked-child",
    principal: principal({ relationships: [] }),
    action: "read",
    resource: resource({ category: "notices" }),
    expected: { granted: false, reason: "denied:no-relationship" },
  },
];

/**
 * Exported so the future implementation's own test file can run this
 * specification against a real adapter — see this file's top comment. NOT
 * invoked anywhere in this repository today.
 */
export function describeGuardianAccessConformance(name: string, create: () => GuardianAccessAdapter): void {
  describe(`GuardianAccessAdapter conformance: ${name} (PROPOSED contract, docs/architecture/guardian-access/)`, () => {
    for (const testCase of GUARDIAN_ACCESS_CASES) {
      it(`${testCase.expected.granted ? "GRANTS" : "DENIES"}: ${testCase.name}`, () => {
        const adapter = create();
        const decision = adapter.check(testCase.principal, testCase.action, testCase.resource);
        expect(decision.granted).toBe(testCase.expected.granted);
        expect(decision.reason).toBe(testCase.expected.reason);
      });
    }

    it("is deterministic — identical inputs yield identical decisions", () => {
      const adapter = create();
      const testCase = GUARDIAN_ACCESS_CASES[0]!;
      const first = adapter.check(testCase.principal, testCase.action, testCase.resource);
      const second = adapter.check(testCase.principal, testCase.action, testCase.resource);
      expect(second).toEqual(first);
    });
  });
}

// ---------------------------------------------------------------------------
// Invitation activation — expired or reused invitations
// ---------------------------------------------------------------------------

export interface InvitationCase {
  readonly name: string;
  readonly invitation: Parameters<InvitationAdapter["checkActivation"]>[0];
  readonly attemptedAt: string;
  readonly expected: InvitationActivationDecision;
}

export const INVITATION_CASES: readonly InvitationCase[] = [
  {
    name: "a pending invitation activates before its expiry",
    invitation: { id: "gin-1", studentId: STUDENT_A, collegeId: COLLEGE, intendedRelationshipType: "parent", contactMethod: "sms", status: "pending", expiresAt: "2026-06-10T00:00:00Z" },
    attemptedAt: "2026-06-01T00:00:00Z",
    expected: { ok: true, reason: "activated" },
  },
  {
    name: "an expired invitation cannot be activated",
    invitation: { id: "gin-2", studentId: STUDENT_A, collegeId: COLLEGE, intendedRelationshipType: "parent", contactMethod: "sms", status: "pending", expiresAt: "2026-06-10T00:00:00Z" },
    attemptedAt: "2026-06-11T00:00:00Z",
    expected: { ok: false, reason: "denied:expired" },
  },
  {
    name: "an already-activated invitation cannot be activated a second time (reuse)",
    invitation: { id: "gin-3", studentId: STUDENT_A, collegeId: COLLEGE, intendedRelationshipType: "parent", contactMethod: "email", status: "activated", expiresAt: "2026-06-10T00:00:00Z" },
    attemptedAt: "2026-06-02T00:00:00Z",
    expected: { ok: false, reason: "denied:already-activated" },
  },
  {
    name: "a revoked invitation cannot be activated even if it has not technically expired",
    invitation: { id: "gin-4", studentId: STUDENT_A, collegeId: COLLEGE, intendedRelationshipType: "parent", contactMethod: "sms", status: "revoked", expiresAt: "2026-06-10T00:00:00Z" },
    attemptedAt: "2026-06-02T00:00:00Z",
    expected: { ok: false, reason: "denied:revoked" },
  },
  {
    name: "an already-expired-status invitation cannot be activated even at an attempt time before expiresAt (status is authoritative once set)",
    invitation: { id: "gin-5", studentId: STUDENT_A, collegeId: COLLEGE, intendedRelationshipType: "parent", contactMethod: "sms", status: "expired", expiresAt: "2026-06-10T00:00:00Z" },
    attemptedAt: "2026-06-02T00:00:00Z",
    expected: { ok: false, reason: "denied:expired" },
  },
];

/** Exported for the same reason as describeGuardianAccessConformance — not
 * invoked anywhere in this repository today. */
export function describeInvitationConformance(name: string, create: () => InvitationAdapter): void {
  describe(`InvitationAdapter conformance: ${name} (PROPOSED contract)`, () => {
    for (const testCase of INVITATION_CASES) {
      it(`${testCase.expected.ok ? "ACTIVATES" : "DENIES"}: ${testCase.name}`, () => {
        const adapter = create();
        const decision = adapter.checkActivation(testCase.invitation, testCase.attemptedAt);
        expect(decision).toEqual(testCase.expected);
      });
    }
  });
}
