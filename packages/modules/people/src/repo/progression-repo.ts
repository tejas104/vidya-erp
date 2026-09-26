import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { ActorType, Db, DurableAuditReceipt, OrgPath, TransactionalAuditLogger } from "@vidya/platform";
import { newId } from "../ids";
import { pplEnrollments, pplGuardianInvitations, pplStudentGuardians, pplStudents } from "../db/schema";
import type { StudentStatus } from "./people-repo";

/** Shared with the RouteSpec so the in-transaction receipt matches (ADR-0026). */
export const PROGRESSION_AUDIT = {
  applied: { action: "people.progression-applied", resourceType: "progression-run" },
  pupil: { action: "people.student-progressed", resourceType: "student" },
} as const;

export type RecordedOutcome = "promoted" | "detained" | "transferred_out" | "graduated";

export interface ProgressionApplyRow {
  readonly studentId: string;
  readonly enrollmentId: string;
  readonly outcome: RecordedOutcome;
  readonly reason: string | null;
  readonly statusAfter: StudentStatus;
  /** Present for promotion and detention: the next year's enrollment. */
  readonly next: { readonly sectionId: string; readonly academicYear: string; readonly startsOn: string } | null;
}

export interface ProgressionApplyInput {
  readonly source: { readonly sectionId: string; readonly academicYear: string; readonly org: OrgPath };
  readonly endsOn: string;
  /** Exits only: when live family access ends and read-only access ends (ADR-0027 Decision 9). */
  readonly familyAccess: { readonly liveUntil: Date; readonly historicalAccessUntil: Date };
  readonly rows: readonly ProgressionApplyRow[];
  readonly attribution: { readonly requestId: string; readonly actorType: ActorType; readonly actorId: string | null };
}

export interface AppliedPupil {
  readonly studentId: string;
  readonly outcome: RecordedOutcome;
  readonly closedEnrollmentId: string;
  readonly newEnrollmentId: string | null;
  readonly statusBefore: string;
  readonly statusAfter: StudentStatus;
  readonly familyAccessChanged: number;
  readonly invitationsRevoked: number;
}

/** A pupil's roll changed between the preview and the apply; nothing was written. */
export class ProgressionConflictError extends Error {
  constructor(readonly studentId: string) {
    super("A pupil's enrollment changed since the preview. Preview again before applying.");
    this.name = "ProgressionConflictError";
  }
}

export interface ProgressionRepo {
  apply(input: ProgressionApplyInput): Promise<{ runId: string; pupils: AppliedPupil[]; receipt: DurableAuditReceipt }>;
}

function pgErrorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
}

/**
 * One transaction for the whole batch: every pupil moves, or none does.
 * Per pupil, the student row is locked first — the same row guardian
 * invitation issue and claim lock — so an exit cannot interleave with a claim.
 * Enrollment rows are updated or inserted, never deleted.
 */
export function createProgressionRepo(db: Db, audit: TransactionalAuditLogger): ProgressionRepo {
  return {
    async apply(input) {
      const runId = newId("prg");
      return db.transaction(async (tx) => {
        const handle = tx as unknown as Db;
        const pupils: AppliedPupil[] = [];
        const rows = [...input.rows].sort((a, b) => a.studentId.localeCompare(b.studentId));
        for (const row of rows) {
          const student = await tx.select({ status: pplStudents.status }).from(pplStudents)
            .where(eq(pplStudents.id, row.studentId)).for("update");
          if (student.length === 0) throw new ProgressionConflictError(row.studentId);
          const exit = row.outcome === "transferred_out" || row.outcome === "graduated";
          const closed = await tx.update(pplEnrollments)
            .set({ status: row.outcome === "transferred_out" ? "withdrawn" : "completed", endsOn: input.endsOn, outcome: row.outcome, outcomeReason: row.reason, updatedAt: new Date() })
            .where(and(
              eq(pplEnrollments.id, row.enrollmentId),
              eq(pplEnrollments.studentId, row.studentId),
              eq(pplEnrollments.sectionId, input.source.sectionId),
              eq(pplEnrollments.academicYear, input.source.academicYear),
              eq(pplEnrollments.status, "enrolled"),
            ))
            .returning({ id: pplEnrollments.id });
          if (closed.length === 0) throw new ProgressionConflictError(row.studentId);

          let newEnrollmentId: string | null = null;
          if (row.next !== null) {
            try {
              const inserted = await tx.insert(pplEnrollments).values({
                id: newId("enr"), studentId: row.studentId, sectionId: row.next.sectionId,
                academicYear: row.next.academicYear, startsOn: row.next.startsOn,
              }).returning({ id: pplEnrollments.id });
              newEnrollmentId = inserted[0]!.id;
            } catch (error) {
              // The partial unique index: already enrolled for the next year.
              if (pgErrorCode(error) === "23505") throw new ProgressionConflictError(row.studentId);
              throw error;
            }
          }
          await tx.update(pplStudents).set({ status: row.statusAfter, updatedAt: new Date() }).where(eq(pplStudents.id, row.studentId));

          let familyAccess: { relationshipId: string; before: { validUntil: string | null; historicalAccessUntil: string | null } }[] = [];
          let invitationsRevoked = 0;
          if (exit) {
            const { liveUntil, historicalAccessUntil } = input.familyAccess;
            // A relationship that already ends on or before the exit keeps its
            // own end; it gains no wind-down window it never had.
            const live = await tx.select().from(pplStudentGuardians).where(and(
              eq(pplStudentGuardians.studentId, row.studentId),
              inArray(pplStudentGuardians.status, ["pending", "active", "restricted"]),
              or(isNull(pplStudentGuardians.validUntil), gt(pplStudentGuardians.validUntil, liveUntil)),
            )).for("update");
            if (live.length > 0) {
              await tx.update(pplStudentGuardians)
                .set({ validUntil: liveUntil, historicalAccessUntil, updatedAt: new Date() })
                .where(inArray(pplStudentGuardians.id, live.map((relationship) => relationship.id)));
            }
            familyAccess = live.map((relationship) => ({
              relationshipId: relationship.id,
              before: { validUntil: relationship.validUntil?.toISOString() ?? null, historicalAccessUntil: relationship.historicalAccessUntil?.toISOString() ?? null },
            }));
            // An unused code would otherwise open live access to a pupil who has left.
            const revoked = await tx.update(pplGuardianInvitations).set({ status: "revoked", updatedAt: new Date() })
              .where(and(eq(pplGuardianInvitations.studentId, row.studentId), eq(pplGuardianInvitations.status, "pending")))
              .returning({ id: pplGuardianInvitations.id });
            invitationsRevoked = revoked.length;
          }

          const applied: AppliedPupil = {
            studentId: row.studentId, outcome: row.outcome, closedEnrollmentId: row.enrollmentId, newEnrollmentId,
            statusBefore: student[0]!.status, statusAfter: row.statusAfter,
            familyAccessChanged: familyAccess.length, invitationsRevoked,
          };
          pupils.push(applied);
          await audit.recordInTransaction(handle, {
            org: input.source.org, module: "people", ...PROGRESSION_AUDIT.pupil,
            actorType: input.attribution.actorType, actorId: input.attribution.actorId,
            resourceId: row.studentId, requestId: input.attribution.requestId,
            details: {
              runId, outcome: row.outcome, reason: row.reason,
              sectionId: input.source.sectionId, academicYear: input.source.academicYear, endsOn: input.endsOn,
              closedEnrollmentId: row.enrollmentId, newEnrollmentId, next: row.next,
              before: { status: applied.statusBefore }, after: { status: row.statusAfter },
              familyAccess: familyAccess.map((entry) => ({
                ...entry,
                after: { validUntil: input.familyAccess.liveUntil.toISOString(), historicalAccessUntil: input.familyAccess.historicalAccessUntil.toISOString() },
              })),
              invitationsRevoked,
            },
          });
        }
        const counts: Record<RecordedOutcome, number> = { promoted: 0, detained: 0, transferred_out: 0, graduated: 0 };
        for (const pupil of pupils) counts[pupil.outcome] += 1;
        // Last step, same transaction: a failed audit write rolls back every pupil.
        const receipt = await audit.recordInTransaction(handle, {
          org: input.source.org, module: "people", ...PROGRESSION_AUDIT.applied,
          actorType: input.attribution.actorType, actorId: input.attribution.actorId,
          resourceId: runId, requestId: input.attribution.requestId,
          details: {
            routeId: "people.progression-apply", status: 200,
            sectionId: input.source.sectionId, academicYear: input.source.academicYear, endsOn: input.endsOn,
            counts, studentIds: pupils.map((pupil) => pupil.studentId),
          },
        });
        return { runId, pupils, receipt };
      });
    },
  };
}
