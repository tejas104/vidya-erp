import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { ActorType, Db, DurableAuditReceipt, OrgPath, TransactionalAuditLogger } from "@vidya/platform";
import { newId } from "../ids";
import { pplEnrollments, pplGuardianInvitations, pplProgressionCorrections, pplStudentGuardians, pplStudents } from "../db/schema";
import type { StudentStatus } from "./people-repo";

/** Shared with the RouteSpec so the in-transaction receipt matches (ADR-0026). */
export const PROGRESSION_AUDIT = {
  applied: { action: "people.progression-applied", resourceType: "progression-run" },
  pupil: { action: "people.student-progressed", resourceType: "student" },
  reversed: { action: "people.progression-reversed", resourceType: "student" },
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
  reverse(input: ProgressionReverseInput): Promise<{ correctionId: string; reinstatedEnrollmentId: string; receipt: DurableAuditReceipt }>;
}

export interface ProgressionReverseInput {
  readonly studentId: string;
  readonly sourceEnrollmentId: string;
  readonly nextEnrollmentId: string | null;
  readonly sectionId: string;
  readonly academicYear: string;
  readonly next: { readonly sectionId: string; readonly academicYear: string; readonly startsOn: string } | null;
  readonly outcome: RecordedOutcome;
  readonly endsOn: string;
  readonly today: string;
  readonly statusBefore: StudentStatus;
  readonly statusAfter: StudentStatus;
  readonly familyAccess: readonly {
    readonly relationshipId: string;
    readonly before: { readonly validUntil: string | null; readonly historicalAccessUntil: string | null };
    readonly after: { readonly validUntil: string; readonly historicalAccessUntil: string };
  }[];
  readonly reason: string;
  readonly org: OrgPath;
  readonly attribution: ProgressionApplyInput["attribution"];
}

export class ProgressionReversalConflictError extends Error {
  constructor(message: string) { super(message); this.name = "ProgressionReversalConflictError"; }
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
export function createProgressionRepo(
  db: Db, audit: TransactionalAuditLogger,
  hasNextYearRecords: (tx: Db, studentId: string, year: string) => Promise<boolean>,
): ProgressionRepo {
  return {
    async reverse(input) {
      const correctionId = newId("prc");
      return db.transaction(async (tx) => {
        const handle = tx as unknown as Db;
        if (input.next !== null) {
          // Dependent-table triggers take this same transaction lock before
          // writing. A committed write is visible to the check below; a later
          // write sees the voided placement and is refused.
          await tx.execute(sql`SELECT ppl_lock_progression_year(${input.studentId}, ${input.next.academicYear})`);
        }
        const student = await tx.select({ status: pplStudents.status }).from(pplStudents)
          .where(eq(pplStudents.id, input.studentId)).for("update");
        if (student[0]?.status !== input.statusAfter) throw new ProgressionReversalConflictError("The pupil's status changed after the outcome was applied.");
        const source = await tx.select().from(pplEnrollments).where(and(
          eq(pplEnrollments.id, input.sourceEnrollmentId), eq(pplEnrollments.studentId, input.studentId),
        )).for("update");
        const original = source[0];
        if (!original || original.outcome !== input.outcome || original.endsOn !== input.endsOn ||
            original.sectionId !== input.sectionId || original.academicYear !== input.academicYear ||
            original.status !== (input.outcome === "transferred_out" ? "withdrawn" : "completed")) {
          throw new ProgressionReversalConflictError("The recorded outcome has changed. Reload the pupil's history.");
        }
        const existing = await tx.select({ id: pplProgressionCorrections.id }).from(pplProgressionCorrections)
          .where(eq(pplProgressionCorrections.sourceEnrollmentId, input.sourceEnrollmentId));
        if (existing.length) throw new ProgressionReversalConflictError("This outcome was already corrected.");
        const enrollments = await tx.select().from(pplEnrollments).where(eq(pplEnrollments.studentId, input.studentId)).for("update");
        const next = input.nextEnrollmentId === null ? null : enrollments.find((row) => row.id === input.nextEnrollmentId);
        if (input.nextEnrollmentId !== null) {
          if (!next || next.status !== "enrolled" || next.outcome !== null || next.startsOn === null ||
              !input.next || next.sectionId !== input.next.sectionId ||
              next.academicYear !== input.next.academicYear || next.startsOn !== input.next.startsOn ||
              next.academicYear <= original.academicYear || next.startsOn <= input.endsOn) {
            throw new ProgressionReversalConflictError("The next-year enrollment has changed.");
          }
          if (next.startsOn <= input.today) {
            throw new ProgressionReversalConflictError("The next-year enrollment has already begun. Review its records before changing the outcome.");
          }
          if (await hasNextYearRecords(handle, input.studentId, next.academicYear)) {
            throw new ProgressionReversalConflictError("The next-year enrollment has attendance, marks, reports, coursework, fees or analytics records. It cannot be reversed.");
          }
        }
        if (enrollments.some((row) => row.status === "enrolled" && row.id !== input.nextEnrollmentId)) {
          throw new ProgressionReversalConflictError("The pupil has another live enrollment.");
        }
        const startsOn = new Date(Date.parse(`${input.endsOn}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        // A corrected year-end result is a new placement, not an erasure of
        // the concluded historical row. Void only the unused next-year row.
        if (next) await tx.update(pplEnrollments).set({ status: "voided", updatedAt: new Date() })
          .where(eq(pplEnrollments.id, next.id));
        const reinstated = await tx.insert(pplEnrollments).values({
          id: newId("enr"), studentId: input.studentId, sectionId: original.sectionId,
          academicYear: original.academicYear, startsOn,
        }).returning({ id: pplEnrollments.id });
        for (const link of input.familyAccess) {
          const relationship = await tx.select().from(pplStudentGuardians)
            .where(and(eq(pplStudentGuardians.id, link.relationshipId), eq(pplStudentGuardians.studentId, input.studentId))).for("update");
          const row = relationship[0];
          if (!row || !["pending", "active", "restricted"].includes(row.status) ||
              row.validUntil?.toISOString() !== link.after.validUntil ||
              row.historicalAccessUntil?.toISOString() !== link.after.historicalAccessUntil) {
            throw new ProgressionReversalConflictError("A family relationship changed after the exit.");
          }
          await tx.update(pplStudentGuardians).set({
            validUntil: link.before.validUntil === null ? null : new Date(link.before.validUntil),
            historicalAccessUntil: link.before.historicalAccessUntil === null ? null : new Date(link.before.historicalAccessUntil),
            updatedAt: new Date(),
          }).where(eq(pplStudentGuardians.id, link.relationshipId));
        }
        await tx.update(pplStudents).set({ status: input.statusBefore, updatedAt: new Date() }).where(eq(pplStudents.id, input.studentId));
        await tx.insert(pplProgressionCorrections).values({
          id: correctionId, studentId: input.studentId, sourceEnrollmentId: input.sourceEnrollmentId,
          nextEnrollmentId: input.nextEnrollmentId, reinstatedEnrollmentId: reinstated[0]!.id, reason: input.reason,
        });
        const receipt = await audit.recordInTransaction(handle, {
          org: input.org, module: "people", ...PROGRESSION_AUDIT.reversed,
          actorType: input.attribution.actorType, actorId: input.attribution.actorId,
          resourceId: input.studentId, requestId: input.attribution.requestId,
          details: {
            routeId: "people.progression-reverse", status: 200, correctionId, reason: input.reason,
            sourceEnrollmentId: input.sourceEnrollmentId, nextEnrollmentId: input.nextEnrollmentId,
            reinstatedEnrollmentId: reinstated[0]!.id, outcome: input.outcome,
            before: { status: input.statusAfter }, after: { status: input.statusBefore },
            familyAccessRestored: input.familyAccess.map((link) => link.relationshipId),
          },
        });
        return { correctionId, reinstatedEnrollmentId: reinstated[0]!.id, receipt };
      });
    },
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
