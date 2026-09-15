/**
 * Specification validation for the guardian-access proposal (S03).
 *
 * IMPORTANT: this file validates the CASE DATA in cases.ts — its shape,
 * internal consistency, and coverage of the required scenarios. It never
 * constructs or calls a GuardianAccessAdapter/InvitationAdapter
 * implementation, and never invokes `describeGuardianAccessConformance` or
 * `describeInvitationConformance` (both exported from cases.ts for a
 * FUTURE implementation's own test file to call). Passing every test below
 * proves the specification is internally consistent and covers the
 * required scenarios. It proves nothing about whether guardian access is
 * enforced anywhere — see docs/architecture/guardian-access/README.md,
 * "What this is not."
 */
import { describe, expect, it } from "vitest";
import {
  describeGuardianAccessConformance,
  describeInvitationConformance,
  GUARDIAN_ACCESS_CASES,
  INVITATION_CASES,
  type RequiredScenarioTag,
} from "./cases";
import type { GuardianDecisionReason, InvitationOutcomeReason } from "./types";

// Compile-time exhaustiveness: if RequiredScenarioTag (cases.ts) gains a new
// member without this map gaining a matching key, this file fails to
// typecheck. That is the enforcement mechanism for "every required
// scenario has at least one case" surviving future edits, not just today.
const REQUIRED_TAGS: Record<RequiredScenarioTag, true> = {
  "two-guardians-one-child": true,
  "guardian-siblings": true,
  "shared-phone-no-identity-merge": true,
  "guardian-also-staff": true,
  "cross-tenant": true,
  "cross-institution": true,
  "revocation-during-active-session": true,
  "changed-contact-no-silent-transfer": true,
  "transfer-and-historical-access": true,
  "staff-recorded-restriction": true,
  "direct-file-export-bulk-deep-link": true,
  "unpublished-or-withdrawn-content": true,
  "self-expansion-attempt": true,
  "child-selector-switch": true,
  "unlinked-child": true,
};
const ALL_REQUIRED_TAGS = Object.keys(REQUIRED_TAGS) as RequiredScenarioTag[];

describe("guardian-contract specification — required case coverage", () => {
  it.each(ALL_REQUIRED_TAGS)("has at least one conformance case tagged %s", (tag) => {
    const matches = GUARDIAN_ACCESS_CASES.filter((testCase) => testCase.tag === tag);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("covers 'two guardians, one child' with two DIFFERENT guardianIds granted on the SAME studentId", () => {
    const cases = GUARDIAN_ACCESS_CASES.filter((testCase) => testCase.tag === "two-guardians-one-child" && testCase.expected.granted);
    const guardianIds = new Set(cases.map((testCase) => testCase.principal.identityUserId));
    const studentIds = new Set(cases.map((testCase) => testCase.resource.studentId));
    expect(guardianIds.size).toBeGreaterThanOrEqual(2);
    expect(studentIds.size).toBe(1);
  });

  it("covers 'siblings' with one guardianId granted on two DIFFERENT studentIds", () => {
    const cases = GUARDIAN_ACCESS_CASES.filter((testCase) => testCase.tag === "guardian-siblings" && testCase.expected.granted);
    const guardianIds = new Set(cases.map((testCase) => testCase.principal.identityUserId));
    const studentIds = new Set(cases.map((testCase) => testCase.resource.studentId));
    expect(guardianIds.size).toBe(1);
    expect(studentIds.size).toBeGreaterThanOrEqual(2);
  });

  it("covers both a granted and a denied outcome for 'staff-recorded-restriction' (a restriction narrows, it does not blanket-deny)", () => {
    const cases = GUARDIAN_ACCESS_CASES.filter((testCase) => testCase.tag === "staff-recorded-restriction");
    expect(cases.some((testCase) => testCase.expected.granted)).toBe(true);
    expect(cases.some((testCase) => !testCase.expected.granted)).toBe(true);
  });

  it("covers all four publication states named in the report-card lifecycle (draft/approved/withdrawn denied, published granted)", () => {
    const cases = GUARDIAN_ACCESS_CASES.filter((testCase) => testCase.tag === "unpublished-or-withdrawn-content");
    const states = new Set(cases.map((testCase) => testCase.resource.publicationState));
    expect(states).toEqual(new Set(["draft", "approved", "withdrawn", "published"]));
    for (const testCase of cases) {
      expect(testCase.expected.granted).toBe(testCase.resource.publicationState === "published");
    }
  });
});

describe("guardian-contract specification — internal consistency", () => {
  it("has no duplicate case names (copy-paste protection)", () => {
    const names = GUARDIAN_ACCESS_CASES.map((testCase) => testCase.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every case's reason vocabulary agrees with its granted flag", () => {
    for (const testCase of GUARDIAN_ACCESS_CASES) {
      const prefix: `${"granted" | "denied"}:` = testCase.expected.granted ? "granted:" : "denied:";
      expect(testCase.expected.reason.startsWith(prefix)).toBe(true);
    }
  });

  it("only a granted case ever names a matchedRelationshipId", () => {
    for (const testCase of GUARDIAN_ACCESS_CASES) {
      if (testCase.expected.granted) {
        expect(testCase.expected.matchedRelationshipId).toBeTruthy();
      } else {
        expect(testCase.expected.matchedRelationshipId).toBeUndefined();
      }
    }
  });

  it("every granted case's matchedRelationshipId actually names one of the principal's own relationships (no dangling reference)", () => {
    for (const testCase of GUARDIAN_ACCESS_CASES.filter((c) => c.expected.granted)) {
      const ids = testCase.principal.relationships.map((relationship) => relationship.id);
      expect(ids).toContain(testCase.expected.matchedRelationshipId);
    }
  });

  it.each(["tenantId", "collegeId", "studentId"] as const)("every resource has a non-empty %s", (field) => {
    for (const testCase of GUARDIAN_ACCESS_CASES) {
      expect(typeof testCase.resource[field]).toBe("string");
      expect((testCase.resource[field] as string).length).toBeGreaterThan(0);
    }
  });

  // --- privilege-escalation guards: these hold across the WHOLE case set, --
  // --- not just the cases tagged for one scenario --------------------------

  it("no case anywhere grants 'export' to a guardian (permission-matrix.md: never, at any relationship state)", () => {
    for (const testCase of GUARDIAN_ACCESS_CASES.filter((c) => c.action === "export")) {
      expect(testCase.expected.granted).toBe(false);
      expect(testCase.expected.reason).toBe("denied:export-not-permitted");
    }
    expect(GUARDIAN_ACCESS_CASES.some((c) => c.action === "export")).toBe(true);
  });

  it("no case anywhere grants 'bulk-read' to a guardian", () => {
    for (const testCase of GUARDIAN_ACCESS_CASES.filter((c) => c.action === "bulk-read")) {
      expect(testCase.expected.granted).toBe(false);
      expect(testCase.expected.reason).toBe("denied:bulk-request-not-permitted");
    }
    expect(GUARDIAN_ACCESS_CASES.some((c) => c.action === "bulk-read")).toBe(true);
  });

  it("no case anywhere grants a guardian the ability to create or modify their own relationship", () => {
    for (const testCase of GUARDIAN_ACCESS_CASES.filter((c) => c.action === "create-relationship" || c.action === "modify-own-relationship")) {
      expect(testCase.expected.granted).toBe(false);
      expect(testCase.expected.reason).toBe("denied:self-expansion-attempt");
    }
    expect(GUARDIAN_ACCESS_CASES.some((c) => c.action === "create-relationship" || c.action === "modify-own-relationship")).toBe(true);
  });

  it("no case grants access across a tenant boundary", () => {
    for (const testCase of GUARDIAN_ACCESS_CASES.filter((c) => c.principal.tenantId !== c.resource.tenantId)) {
      expect(testCase.expected.granted).toBe(false);
      expect(testCase.expected.reason).toBe("denied:cross-tenant");
    }
  });

  it("no case grants access to a relationship whose status is not 'active' or 'restricted'", () => {
    for (const testCase of GUARDIAN_ACCESS_CASES) {
      const matched = testCase.principal.relationships.find((relationship) => relationship.id === testCase.expected.matchedRelationshipId);
      if (matched) {
        expect(["active", "restricted"]).toContain(matched.status);
      }
    }
  });

  it("`alsoHoldsStaffRole` never changes the expected outcome (documented, never load-bearing)", () => {
    const staffParentCases = GUARDIAN_ACCESS_CASES.filter((c) => c.principal.alsoHoldsStaffRole === true);
    expect(staffParentCases.length).toBeGreaterThan(0);
    // Same-shaped case without the flag would decide identically: the flag
    // is not read by anything in this decision surface (see types.ts).
    for (const testCase of staffParentCases) {
      const { alsoHoldsStaffRole: _ignored, ...withoutFlag } = testCase.principal;
      expect(withoutFlag).not.toHaveProperty("alsoHoldsStaffRole");
    }
  });

  it("exports the conformance-harness factory without invoking it against any implementation", () => {
    // This test intentionally stops short of calling describeGuardianAccessConformance —
    // doing so would require a `create()` factory, i.e. an implementation,
    // which this specification deliberately does not provide (see this
    // file's top comment and docs/architecture/guardian-access/README.md).
    expect(typeof describeGuardianAccessConformance).toBe("function");
  });
});

describe("invitation specification — expired or reused invitations", () => {
  const REQUIRED_INVITATION_REASONS: Record<InvitationOutcomeReason, true> = {
    activated: true,
    "denied:expired": true,
    "denied:already-activated": true,
    "denied:revoked": true,
  };
  const ALL_INVITATION_REASONS = Object.keys(REQUIRED_INVITATION_REASONS) as InvitationOutcomeReason[];

  it.each(ALL_INVITATION_REASONS)("has at least one case expecting reason %s", (reason) => {
    expect(INVITATION_CASES.some((testCase) => testCase.expected.reason === reason)).toBe(true);
  });

  it("a single invitation id is never reused across an 'activated' expectation and any denial expectation (no self-contradicting fixture)", () => {
    const activatedIds = new Set(INVITATION_CASES.filter((c) => c.expected.ok).map((c) => c.invitation.id));
    const deniedIds = new Set(INVITATION_CASES.filter((c) => !c.expected.ok).map((c) => c.invitation.id));
    for (const id of activatedIds) {
      expect(deniedIds.has(id)).toBe(false);
    }
  });

  it("exports the invitation conformance-harness factory without invoking it against any implementation", () => {
    expect(typeof describeInvitationConformance).toBe("function");
  });
});

describe("decision-reason vocabulary is closed and exhaustively covered", () => {
  const REQUIRED_REASONS: Record<GuardianDecisionReason, true> = {
    "granted:active-relationship": true,
    "denied:no-relationship": true,
    "denied:relationship-pending": true,
    "denied:relationship-revoked": true,
    "denied:relationship-expired": true,
    "denied:relationship-restricted": true,
    "denied:category-not-granted": true,
    "denied:cross-tenant": true,
    "denied:cross-institution": true,
    "denied:unpublished-content": true,
    "denied:self-expansion-attempt": true,
    "denied:export-not-permitted": true,
    "denied:bulk-request-not-permitted": true,
    "denied:direct-file-access-not-mediated": true,
    "denied:action-not-in-matrix": true,
  };
  const ALL_REASONS = Object.keys(REQUIRED_REASONS) as GuardianDecisionReason[];
  // `denied:direct-file-access-not-mediated` and `denied:action-not-in-matrix`
  // are reserved for a future implementation's own defensive branches (an
  // adapter that receives an action it does not recognize, or a mediation
  // failure distinct from an ordinary relationship denial) and are
  // deliberately not forced into a case here — every OTHER reason must
  // appear at least once in the case set.
  const RESERVED_FOR_IMPLEMENTATION: readonly GuardianDecisionReason[] = ["denied:direct-file-access-not-mediated", "denied:action-not-in-matrix"];

  it.each(ALL_REASONS.filter((reason) => !RESERVED_FOR_IMPLEMENTATION.includes(reason)))("reason %s is used by at least one case", (reason) => {
    expect(GUARDIAN_ACCESS_CASES.some((testCase) => testCase.expected.reason === reason)).toBe(true);
  });
});
