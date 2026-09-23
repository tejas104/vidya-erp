import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import {
  pplGuardianInvitations,
  pplGuardians,
  pplStudentGuardians,
  type PplGuardianInvitationRow,
  type PplGuardianRow,
  type PplStudentGuardianRow,
} from "../db/schema";
import type { GuardianRecordCategory, RelationshipStatus, RelationshipType, VerificationState } from "../guardian-contract/types";

export type InvitationRow = PplGuardianInvitationRow;
export type RelationshipRow = PplStudentGuardianRow;
export type GuardianRow = PplGuardianRow;

export interface NewRelationship {
  readonly studentId: string;
  readonly collegeId: string;
  readonly relationshipType: RelationshipType;
  readonly verificationState: VerificationState;
  readonly status: RelationshipStatus;
  readonly grantedCategories: readonly GuardianRecordCategory[];
  readonly isPrimaryContact: boolean;
}

export type NewGuardian =
  | { readonly id: string }
  | { readonly identityUserId: string; readonly fullName: string; readonly primaryPhone: string | null; readonly primaryEmail: string | null };

/** Thrown when the invitation was claimed, revoked or expired between the
 *  caller's check and its write. The atomic claim is the arbiter. */
export class InvitationNotClaimableError extends Error {
  constructor() {
    super("invitation is no longer pending");
    this.name = "InvitationNotClaimableError";
  }
}

export interface GuardiansRepo {
  createInvitation(
    input: Omit<InvitationRow, "id" | "status" | "activatedRelationshipId" | "createdAt" | "updatedAt">,
  ): Promise<InvitationRow>;
  /** Re-issue (ADR-0027 Decision 7): earlier pending invitations for the same
   *  pupil AND the same contact are revoked, so only the newest code works. */
  revokePendingFor(studentId: string, contactValue: string): Promise<number>;
  findInvitationByCodeHash(codeHash: string): Promise<InvitationRow | null>;
  pendingInvitationsFor(studentId: string, now: Date): Promise<InvitationRow[]>;
  /** Relationships of a pupil that count toward the verification threshold. */
  countLiveRelationships(studentId: string): Promise<number>;
  relationshipsForStudent(studentId: string): Promise<(RelationshipRow & { guardianName: string })[]>;
  relationshipsForGuardian(guardianId: string): Promise<RelationshipRow[]>;
  getRelationship(id: string): Promise<RelationshipRow | null>;
  setRelationshipState(
    id: string,
    patch: { status: RelationshipStatus; verificationState?: VerificationState; reason: string | null; changedBy: string },
  ): Promise<RelationshipRow | null>;
  guardianByIdentityUser(identityUserId: string): Promise<GuardianRow | null>;
  /**
   * Atomically claims a pending, unexpired invitation and attaches the
   * relationship it describes to a guardian, creating the guardian row when
   * given no id. One transaction: either the invitation is spent AND the
   * relationship exists, or neither. A pair that already has a relationship
   * (a revoked one being re-invited) is updated in place.
   */
  claimInvitation(input: {
    invitationId: string;
    now: Date;
    guardian: NewGuardian;
    relationship: NewRelationship;
  }): Promise<{ guardianId: string; relationship: RelationshipRow }>;
}

export function createGuardiansRepo(db: Db): GuardiansRepo {
  return {
    async createInvitation(input) {
      const rows = await db
        .insert(pplGuardianInvitations)
        .values({ id: `gin_${randomUUID()}`, ...input })
        .returning();
      return rows[0]!;
    },

    async revokePendingFor(studentId, contactValue) {
      const rows = await db
        .update(pplGuardianInvitations)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(
          and(
            eq(pplGuardianInvitations.studentId, studentId),
            eq(pplGuardianInvitations.contactValue, contactValue),
            eq(pplGuardianInvitations.status, "pending"),
          ),
        )
        .returning({ id: pplGuardianInvitations.id });
      return rows.length;
    },

    async findInvitationByCodeHash(codeHash) {
      const rows = await db
        .select()
        .from(pplGuardianInvitations)
        .where(eq(pplGuardianInvitations.codeHash, codeHash))
        .limit(1);
      return rows[0] ?? null;
    },

    async pendingInvitationsFor(studentId, now) {
      return db
        .select()
        .from(pplGuardianInvitations)
        .where(
          and(
            eq(pplGuardianInvitations.studentId, studentId),
            eq(pplGuardianInvitations.status, "pending"),
            gt(pplGuardianInvitations.expiresAt, now),
          ),
        )
        .orderBy(asc(pplGuardianInvitations.createdAt));
    },

    async countLiveRelationships(studentId) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(pplStudentGuardians)
        .where(
          and(
            eq(pplStudentGuardians.studentId, studentId),
            inArray(pplStudentGuardians.status, ["pending", "active", "restricted"]),
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async relationshipsForStudent(studentId) {
      const rows = await db
        .select({ relationship: pplStudentGuardians, guardianName: pplGuardians.fullName })
        .from(pplStudentGuardians)
        .innerJoin(pplGuardians, eq(pplGuardians.id, pplStudentGuardians.guardianId))
        .where(eq(pplStudentGuardians.studentId, studentId))
        .orderBy(asc(pplStudentGuardians.createdAt));
      return rows.map((row) => ({ ...row.relationship, guardianName: row.guardianName }));
    },

    async relationshipsForGuardian(guardianId) {
      return db
        .select()
        .from(pplStudentGuardians)
        .where(eq(pplStudentGuardians.guardianId, guardianId))
        .orderBy(asc(pplStudentGuardians.createdAt));
    },

    async getRelationship(id) {
      const rows = await db.select().from(pplStudentGuardians).where(eq(pplStudentGuardians.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async setRelationshipState(id, patch) {
      const rows = await db
        .update(pplStudentGuardians)
        .set({
          status: patch.status,
          ...(patch.verificationState !== undefined ? { verificationState: patch.verificationState } : {}),
          statusReason: patch.reason,
          statusChangedBy: patch.changedBy,
          updatedAt: new Date(),
        })
        .where(eq(pplStudentGuardians.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async guardianByIdentityUser(identityUserId) {
      const rows = await db
        .select()
        .from(pplGuardians)
        .where(eq(pplGuardians.identityUserId, identityUserId))
        .limit(1);
      return rows[0] ?? null;
    },

    async claimInvitation({ invitationId, now, guardian, relationship }) {
      return db.transaction(async (tx) => {
        const claimed = await tx
          .update(pplGuardianInvitations)
          .set({ status: "activated", updatedAt: now })
          .where(
            and(
              eq(pplGuardianInvitations.id, invitationId),
              eq(pplGuardianInvitations.status, "pending"),
              gt(pplGuardianInvitations.expiresAt, now),
            ),
          )
          .returning({ id: pplGuardianInvitations.id });
        if (claimed.length === 0) {
          throw new InvitationNotClaimableError();
        }
        let guardianId: string;
        if ("id" in guardian) {
          guardianId = guardian.id;
        } else {
          guardianId = `grd_${randomUUID()}`;
          await tx.insert(pplGuardians).values({ id: guardianId, ...guardian });
        }
        const values = {
          collegeId: relationship.collegeId,
          relationshipType: relationship.relationshipType,
          verificationState: relationship.verificationState,
          status: relationship.status,
          grantedCategories: [...relationship.grantedCategories],
          isPrimaryContact: relationship.isPrimaryContact,
          restrictions: [],
          validFrom: now,
          validUntil: null,
          historicalAccessUntil: null,
          statusReason: null,
          statusChangedBy: null,
          updatedAt: now,
        };
        const rows = await tx
          .insert(pplStudentGuardians)
          .values({ id: `sgr_${randomUUID()}`, guardianId, studentId: relationship.studentId, ...values })
          .onConflictDoUpdate({ target: [pplStudentGuardians.guardianId, pplStudentGuardians.studentId], set: values })
          .returning();
        const row = rows[0]!;
        await tx
          .update(pplGuardianInvitations)
          .set({ activatedRelationshipId: row.id })
          .where(eq(pplGuardianInvitations.id, invitationId));
        return { guardianId, relationship: row };
      });
    },
  };
}
