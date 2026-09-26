import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
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

/** Statuses a year-end exit sets; invitations are closed for these pupils. */
const PUPIL_LEFT_STATUSES: ReadonlySet<string> = new Set(["transferred", "alumni"]);

export class PupilHasLeftError extends Error {
  constructor() {
    super("This pupil has left the school, so new family invitations are closed.");
    this.name = "PupilHasLeftError";
  }
}

export interface GuardiansRepo {
  /** Reissue is one transaction: pupil lock, prior revocation, new code. */
  issueInvitation(
    input: Omit<InvitationRow, "id" | "status" | "activatedRelationshipId" | "createdAt" | "updatedAt">,
  ): Promise<{ invitation: InvitationRow; revokedPrior: number }>;
  findInvitationByCodeHash(codeHash: string): Promise<InvitationRow | null>;
  pendingInvitationsFor(studentId: string, now: Date): Promise<InvitationRow[]>;
  relationshipsForStudent(studentId: string): Promise<(RelationshipRow & { guardianName: string })[]>;
  relationshipsForGuardian(guardianId: string): Promise<RelationshipRow[]>;
  getRelationship(id: string): Promise<RelationshipRow | null>;
  setRelationshipState(
    id: string,
    patch: { status: RelationshipStatus; expectedStatus?: RelationshipStatus; verificationState?: VerificationState; reason: string | null; changedBy: string },
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
    /** Called under the pupil row lock, after counting live relationships. */
    relationship: (liveRelationships: number) => NewRelationship;
  }): Promise<{ guardianId: string; relationship: RelationshipRow }>;
}

export function createGuardiansRepo(db: Db): GuardiansRepo {
  return {
    async issueInvitation(input) {
      return db.transaction(async (tx) => {
        const locked = await tx.execute(sql`SELECT status FROM ppl_students WHERE id = ${input.studentId} FOR UPDATE`);
        // Year-end exits revoke pending codes under this same lock; a new code
        // for a pupil who has left would re-open live access (ADR-0027 Decision 9).
        if (PUPIL_LEFT_STATUSES.has(String((locked.rows[0] as { status?: string } | undefined)?.status))) throw new PupilHasLeftError();
        const revoked = await tx
          .update(pplGuardianInvitations)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(and(
            eq(pplGuardianInvitations.studentId, input.studentId),
            eq(pplGuardianInvitations.contactValue, input.contactValue),
            eq(pplGuardianInvitations.status, "pending"),
          ))
          .returning({ id: pplGuardianInvitations.id });
        const rows = await tx
          .insert(pplGuardianInvitations)
          .values({ id: `gin_${randomUUID()}`, ...input })
          .returning();
        return { invitation: rows[0]!, revokedPrior: revoked.length };
      });
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
        .where(and(
          eq(pplStudentGuardians.id, id),
          patch.expectedStatus !== undefined ? eq(pplStudentGuardians.status, patch.expectedStatus) : undefined,
        ))
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

    async claimInvitation({ invitationId, now, guardian, relationship: makeRelationship }) {
      return db.transaction(async (tx) => {
        const invitationRows = await tx
          .select({ studentId: pplGuardianInvitations.studentId })
          .from(pplGuardianInvitations)
          .where(eq(pplGuardianInvitations.id, invitationId))
          .limit(1);
        if (invitationRows.length === 0) throw new InvitationNotClaimableError();
        const studentId = invitationRows[0]!.studentId;
        // Every invitation issue and claim for this pupil locks in the same
        // order, so concurrent reissue cannot race a claim or deadlock it.
        await tx.execute(sql`SELECT id FROM ppl_students WHERE id = ${studentId} FOR UPDATE`);
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
        // Claims for different codes of the same pupil now count serially.
        const liveRows = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(pplStudentGuardians)
          .where(and(
            eq(pplStudentGuardians.studentId, studentId),
            inArray(pplStudentGuardians.status, ["pending", "active", "restricted"]),
            "id" in guardian ? ne(pplStudentGuardians.guardianId, guardian.id) : undefined,
          ));
        const relationship = makeRelationship(liveRows[0]?.count ?? 0);
        if (relationship.studentId !== studentId) throw new Error("invitation pupil and relationship pupil differ");
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
