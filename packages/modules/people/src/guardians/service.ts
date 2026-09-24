import { createHash, randomInt } from "node:crypto";
import { createGuardianAccessAdapter, createInvitationAdapter } from "../guardian-contract/adapter";
import type {
  GuardianAccessAction,
  GuardianAccessDecision,
  GuardianPrincipal,
  GuardianRecordCategory,
  GuardianRestriction,
  InvitationOutcomeReason,
  InvitationStatus,
  PublicationState,
  RelationshipStatus,
  RelationshipType,
  StudentGuardianRelationship,
  VerificationState,
} from "../guardian-contract/types";
import {
  InvitationNotClaimableError,
  type GuardiansRepo,
  type InvitationRow,
  type NewGuardian,
  type RelationshipRow,
} from "./repo";

/**
 * Guardian lifecycle and access (ADR-0027). Invitations → relationships →
 * per-request access decisions. Every authorization answer comes from the
 * pure GuardianAccessAdapter; this service only gathers its inputs fresh
 * from the database (Decision 2) and persists outcomes.
 */

// ponytail: one deployment is one tenant today. The adapter still compares
// tenants, so a multi-tenant deployment changes only this constant's source.
export const DEPLOYMENT_TENANT = "deployment";

/** ADR-0027 Decision 7. */
export const INVITATION_TTL_HOURS = 72;

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
/** ADR-0027 Decision 6: what a person collecting a child from the gate needs,
 *  and nothing that discloses academic standing or money. */
const CONTACT_CATEGORIES: readonly GuardianRecordCategory[] = ["attendance", "notices", "timetable"];

export function defaultCategories(type: RelationshipType): readonly GuardianRecordCategory[] {
  return type === "other-authorized-contact" ? CONTACT_CATEGORIES : ALL_CATEGORIES;
}

/**
 * ADR-0027 Decision 5. A relationship becomes active on self-attestation only
 * for the first `selfAttestedLimit` adults linked to a pupil; beyond that, and
 * for any other-authorized-contact whatever the limit, it waits as `pending`
 * until staff verify it. (The database holds the contact rule too.)
 */
export function initialRelationshipState(input: {
  type: RelationshipType;
  staffVerified: boolean;
  liveRelationships: number;
  selfAttestedLimit: number;
}): { status: RelationshipStatus; verificationState: VerificationState } {
  const verificationState: VerificationState = input.staffVerified ? "staff-verified" : "self-attested";
  const needsStaff = input.type === "other-authorized-contact" || input.liveRelationships >= input.selfAttestedLimit;
  return { status: needsStaff && !input.staffVerified ? "pending" : "active", verificationState };
}

// Crockford-style alphabet: no I, L, O or U, so a code read aloud or copied
// from paper survives. 20 characters ≈ 100 bits.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";

export function generateInvitationCode(): string {
  let raw = "";
  for (let i = 0; i < 20; i += 1) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return raw.match(/.{5}/g)!.join("-");
}

/** Case, spaces and dashes are presentation; the hash is over the letters. */
export function hashInvitationCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

export interface StudentBrief {
  readonly studentId: string;
  readonly collegeId: string;
  readonly fullName: string;
  readonly admissionNo: string;
}

export interface GuardianAccountCreator {
  createGuardianAccount(input: {
    username: string;
    displayName: string;
    collegeId: string;
    password: string;
  }): Promise<{ userId: string; username: string }>;
}

export interface GuardianServiceDeps {
  readonly repo: GuardiansRepo;
  readonly student: (studentId: string) => Promise<StudentBrief | null>;
  readonly accounts: GuardianAccountCreator;
  readonly selfAttestedLimit: number;
  readonly now?: () => Date;
}

export class InvitationRefusedError extends Error {
  constructor(readonly reason: InvitationOutcomeReason | "denied:unknown-code") {
    super(`invitation refused: ${reason}`);
    this.name = "InvitationRefusedError";
  }
}

function toContract(row: RelationshipRow, now: Date): StudentGuardianRelationship {
  // A relationship past its validUntil is expired whatever its stored status;
  // the adapter reads status only, so the lapse is applied here.
  const lapsed = row.validUntil !== null && row.validUntil.getTime() <= now.getTime();
  return {
    id: row.id,
    guardianId: row.guardianId,
    studentId: row.studentId,
    collegeId: row.collegeId,
    relationshipType: row.relationshipType as RelationshipType,
    isPrimaryContact: row.isPrimaryContact,
    verificationState: row.verificationState as VerificationState,
    status: lapsed && row.status !== "revoked" ? "expired" : (row.status as RelationshipStatus),
    grantedCategories: new Set(row.grantedCategories as GuardianRecordCategory[]),
    restrictions: row.restrictions as GuardianRestriction[],
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    historicalAccessUntil: row.historicalAccessUntil?.toISOString() ?? null,
  };
}

export class GuardianService {
  private readonly adapter = createGuardianAccessAdapter();
  private readonly invitations = createInvitationAdapter();
  private readonly now: () => Date;

  constructor(private readonly deps: GuardianServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Returns the plaintext code exactly once; only its hash is stored. */
  async issueInvitation(input: {
    student: StudentBrief;
    guardianName: string;
    relationshipType: RelationshipType;
    contactMethod: "sms" | "email";
    contactValue: string;
    staffVerified: boolean;
    issuedBy: string;
  }): Promise<{ invitation: InvitationRow; code: string; revokedPrior: number }> {
    const code = generateInvitationCode();
    const now = this.now();
    const { invitation, revokedPrior } = await this.deps.repo.issueInvitation({
      studentId: input.student.studentId,
      collegeId: input.student.collegeId,
      guardianName: input.guardianName,
      relationshipType: input.relationshipType,
      contactMethod: input.contactMethod,
      contactValue: input.contactValue,
      staffVerified: input.staffVerified,
      codeHash: hashInvitationCode(code),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_HOURS * 3_600_000),
      issuedBy: input.issuedBy,
    });
    return { invitation, code, revokedPrior };
  }

  async forStudent(studentId: string) {
    return {
      relationships: await this.deps.repo.relationshipsForStudent(studentId),
      invitations: await this.deps.repo.pendingInvitationsFor(studentId, this.now()),
    };
  }

  getRelationship(id: string): Promise<RelationshipRow | null> {
    return this.deps.repo.getRelationship(id);
  }

  /** Staff verification lifts a pending relationship to active. */
  async verify(relationship: RelationshipRow, actorId: string): Promise<RelationshipRow | null> {
    const status: RelationshipStatus = relationship.status === "pending" ? "active" : (relationship.status as RelationshipStatus);
    return this.deps.repo.setRelationshipState(relationship.id, {
      status,
      expectedStatus: relationship.status as RelationshipStatus,
      verificationState: "staff-verified",
      reason: null,
      changedBy: actorId,
    });
  }

  /** Takes effect on the guardian's very next request (Decision 2). */
  revoke(relationship: RelationshipRow, reason: string, actorId: string): Promise<RelationshipRow | null> {
    return this.deps.repo.setRelationshipState(relationship.id, { status: "revoked", reason, changedBy: actorId });
  }

  /** A new adult: creates their guardian login, then claims the invitation. */
  async activate(input: { code: string; username: string; password: string; fullName: string }) {
    const invitation = await this.claimable(input.code);
    const student = await this.requireStudent(invitation.studentId);
    const account = await this.deps.accounts.createGuardianAccount({
      username: input.username,
      displayName: input.fullName,
      collegeId: student.collegeId,
      password: input.password,
    });
    // ponytail: the account is created before the claim, so losing a race
    // for the same code leaves a guardian login with no relationships. It
    // holds no authority (no relationship ⇒ every check denies); a cleanup
    // job can reap such accounts if they ever appear in practice.
    const claimed = await this.claim(invitation, {
      identityUserId: account.userId,
      fullName: input.fullName,
      primaryPhone: invitation.contactMethod === "sms" ? invitation.contactValue : null,
      primaryEmail: invitation.contactMethod === "email" ? invitation.contactValue : null,
    });
    return { ...claimed, userId: account.userId, username: account.username, student };
  }

  /** An adult who already has a guardian login (a second child). */
  async redeem(input: { code: string; identityUserId: string }) {
    const guardian = await this.deps.repo.guardianByIdentityUser(input.identityUserId);
    if (guardian === null || guardian.status !== "active") {
      throw new InvitationRefusedError("denied:unknown-code");
    }
    const invitation = await this.claimable(input.code);
    const student = await this.requireStudent(invitation.studentId);
    return { ...(await this.claim(invitation, { id: guardian.id })), student };
  }

  /**
   * The guardian as the adapter sees them, built fresh for this request.
   * Null for an unknown or non-active guardian: suspending the guardian row
   * cuts off every child at once, independent of the relationships.
   */
  async principalFor(identityUserId: string): Promise<GuardianPrincipal | null> {
    const guardian = await this.deps.repo.guardianByIdentityUser(identityUserId);
    if (guardian === null || guardian.status !== "active") return null;
    const now = this.now();
    const rows = await this.deps.repo.relationshipsForGuardian(guardian.id);
    return {
      identityUserId,
      tenantId: DEPLOYMENT_TENANT,
      relationships: rows.map((row) => toContract(row, now)),
    };
  }

  /** The single access question every guardian-facing read asks. */
  async access(
    identityUserId: string,
    action: GuardianAccessAction,
    studentId: string,
    category: GuardianRecordCategory,
    publicationState?: PublicationState,
  ): Promise<{ decision: GuardianAccessDecision; student: StudentBrief | null }> {
    const principal = await this.principalFor(identityUserId);
    if (principal === null) {
      return { decision: { granted: false, reason: "denied:no-relationship" }, student: null };
    }
    // Refuse without looking the pupil up when no relationship names them,
    // so an unrelated id cannot be used to learn whether a pupil exists.
    if (!principal.relationships.some((relationship) => relationship.studentId === studentId)) {
      return { decision: { granted: false, reason: "denied:no-relationship" }, student: null };
    }
    const student = await this.deps.student(studentId);
    if (student === null) {
      return { decision: { granted: false, reason: "denied:no-relationship" }, student: null };
    }
    const decision = this.adapter.check(principal, action, {
      tenantId: DEPLOYMENT_TENANT,
      collegeId: student.collegeId,
      studentId,
      category,
      ...(publicationState !== undefined ? { publicationState } : {}),
    });
    return { decision, student: decision.granted ? student : null };
  }

  /** "Which children am I linked to?" — the guardian's own relationship record. */
  async children(identityUserId: string) {
    const principal = await this.principalFor(identityUserId);
    if (principal === null) return [];
    const children = [];
    for (const relationship of principal.relationships) {
      if (relationship.status === "revoked") continue;
      const student = await this.deps.student(relationship.studentId);
      if (student === null) continue;
      children.push({
        studentId: student.studentId,
        fullName: student.fullName,
        admissionNo: student.admissionNo,
        relationshipType: relationship.relationshipType,
        status: relationship.status,
        categories: [...relationship.grantedCategories].sort(),
      });
    }
    return children;
  }

  private async claimable(code: string): Promise<InvitationRow> {
    const invitation = await this.deps.repo.findInvitationByCodeHash(hashInvitationCode(code));
    if (invitation === null) throw new InvitationRefusedError("denied:unknown-code");
    const verdict = this.invitations.checkActivation(
      {
        id: invitation.id,
        studentId: invitation.studentId,
        collegeId: invitation.collegeId,
        intendedRelationshipType: invitation.relationshipType as RelationshipType,
        contactMethod: invitation.contactMethod as "sms" | "email",
        status: invitation.status as InvitationStatus,
        expiresAt: invitation.expiresAt.toISOString(),
      },
      this.now().toISOString(),
    );
    if (!verdict.ok) throw new InvitationRefusedError(verdict.reason);
    return invitation;
  }

  private async requireStudent(studentId: string): Promise<StudentBrief> {
    const student = await this.deps.student(studentId);
    // The invitation's pupil was deleted after issue: the code is spent.
    if (student === null) throw new InvitationRefusedError("denied:revoked");
    return student;
  }

  private async claim(invitation: InvitationRow, guardian: NewGuardian) {
    const type = invitation.relationshipType as RelationshipType;
    try {
      return await this.deps.repo.claimInvitation({
        invitationId: invitation.id,
        now: this.now(),
        guardian,
        relationship: (liveRelationships) => ({
          studentId: invitation.studentId,
          collegeId: invitation.collegeId,
          relationshipType: type,
          ...initialRelationshipState({
            type,
            staffVerified: invitation.staffVerified,
            liveRelationships,
            selfAttestedLimit: this.deps.selfAttestedLimit,
          }),
          grantedCategories: defaultCategories(type),
          isPrimaryContact: liveRelationships === 0,
        }),
      });
    } catch (error) {
      if (error instanceof InvitationNotClaimableError) throw new InvitationRefusedError("denied:already-activated");
      throw error;
    }
  }
}
