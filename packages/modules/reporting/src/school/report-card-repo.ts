import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { rptSchoolReportCards, rptSchoolReportCardPublications, type RptSchoolReportCardRow } from "../db/schema";
import type { ReportCardSnapshot } from "./report-card-contract";
import type { DocumentStyle } from "./document-format";

export interface NewReportCardSnapshot {
  readonly studentId: string;
  readonly termId: string;
  readonly academicYear: string;
  readonly collegeId: string;
  readonly departmentId: string;
  readonly classId: string;
  readonly sectionId: string | null;
  readonly payload: ReportCardSnapshot;
  readonly documentStyle?: DocumentStyle;
  readonly generatedBy: string;
}

export interface ReportCardRepo {
  /** Appends a new snapshot. There is deliberately no update method: the
   *  table is append-only and the database enforces it. */
  insert(input: NewReportCardSnapshot): Promise<RptSchoolReportCardRow>;
  get(id: string): Promise<RptSchoolReportCardRow | null>;
  /** The latest snapshot per student for one term, for the roster view. */
  latestForTerm(
    studentIds: readonly string[],
    termId: string,
  ): Promise<Map<string, { id: string; generatedAt: Date }>>;
  /**
   * Current release for a pupil and term; null means never released or withdrawn.
   * With `publishedBefore` (a guardian after the pupil left, ADR-0027 Decision 9)
   * a release made at or after that instant counts as none; a later withdrawal
   * still hides the card.
   */
  publishedForTerm(studentId: string, termId: string, publishedBefore?: Date): Promise<string | null>;
  /** Current published snapshots, one per term; `publishedBefore` as for publishedForTerm. */
  publishedForStudent(studentId: string, publishedBefore?: Date): Promise<RptSchoolReportCardRow[]>;
  /** Serialized per pupil/term; returns false if the requested state is already current. */
  publicationChange(input: { studentId: string; termId: string; snapshotId: string | null; actorId: string; expectedCurrent?: string }): Promise<boolean>;
}

export function createReportCardRepo(db: Db): ReportCardRepo {
  return {
    async insert(input) {
      const [row] = await db
        .insert(rptSchoolReportCards)
        .values({ ...input, id: `src_${randomUUID()}` })
        .returning();
      // The insert either returns its row or throws; a missing row here would
      // mean the driver contract broke, not an expected empty result.
      return row!;
    },

    async get(id) {
      const [row] = await db
        .select()
        .from(rptSchoolReportCards)
        .where(eq(rptSchoolReportCards.id, id))
        .limit(1);
      return row ?? null;
    },

    async latestForTerm(studentIds, termId) {
      if (studentIds.length === 0) return new Map();
      const rows = await db
        .select({
          id: rptSchoolReportCards.id,
          studentId: rptSchoolReportCards.studentId,
          generatedAt: rptSchoolReportCards.generatedAt,
        })
        .from(rptSchoolReportCards)
        .where(
          and(
            eq(rptSchoolReportCards.termId, termId),
            inArray(rptSchoolReportCards.studentId, [...studentIds]),
          ),
        )
        .orderBy(desc(rptSchoolReportCards.generatedAt));
      // Ordered newest-first, so the FIRST row seen for a student is the
      // latest one; later (older) rows for that student are skipped.
      const latest = new Map<string, { id: string; generatedAt: Date }>();
      for (const row of rows) {
        if (!latest.has(row.studentId)) {
          latest.set(row.studentId, { id: row.id, generatedAt: row.generatedAt });
        }
      }
      return latest;
    },

    async publishedForTerm(studentId, termId, publishedBefore) {
      const [event] = await db.select().from(rptSchoolReportCardPublications)
        .where(and(eq(rptSchoolReportCardPublications.studentId, studentId), eq(rptSchoolReportCardPublications.termId, termId)))
        .orderBy(desc(rptSchoolReportCardPublications.id)).limit(1);
      return event?.action === "published" && (publishedBefore === undefined || event.createdAt < publishedBefore) ? event.snapshotId : null;
    },

    async publishedForStudent(studentId, publishedBefore) {
      const events = await db.select().from(rptSchoolReportCardPublications)
        .where(eq(rptSchoolReportCardPublications.studentId, studentId))
        .orderBy(desc(rptSchoolReportCardPublications.id));
      const current = new Map<string, string | null>();
      for (const event of events) {
        if (current.has(event.termId)) continue;
        current.set(event.termId, event.action === "published" && (publishedBefore === undefined || event.createdAt < publishedBefore) ? event.snapshotId : null);
      }
      const ids = [...current.values()].filter((id): id is string => id !== null);
      if (ids.length === 0) return [];
      return db.select().from(rptSchoolReportCards).where(inArray(rptSchoolReportCards.id, ids))
        .orderBy(desc(rptSchoolReportCards.generatedAt));
    },

    async publicationChange({ studentId, termId, snapshotId, actorId, expectedCurrent }) {
      return db.transaction(async (tx) => {
        // A pupil/term lock prevents two staff decisions racing past the same state.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${studentId}), hashtext(${termId}))`);
        const [current] = await tx.select().from(rptSchoolReportCardPublications)
          .where(and(eq(rptSchoolReportCardPublications.studentId, studentId), eq(rptSchoolReportCardPublications.termId, termId)))
          .orderBy(desc(rptSchoolReportCardPublications.id)).limit(1);
        const currentId = current?.action === "published" ? current.snapshotId : null;
        if (expectedCurrent !== undefined && currentId !== expectedCurrent) return false;
        if (currentId === snapshotId) return false;
        await tx.insert(rptSchoolReportCardPublications).values({
          studentId, termId, snapshotId,
          action: snapshotId === null ? "withdrawn" : "published",
          actorId,
        });
        return true;
      });
    },
  };
}
