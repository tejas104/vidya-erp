import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { rptSchoolReportCards, type RptSchoolReportCardRow } from "../db/schema";
import type { ReportCardSnapshot } from "./report-card-contract";

export interface NewReportCardSnapshot {
  readonly studentId: string;
  readonly termId: string;
  readonly academicYear: string;
  readonly collegeId: string;
  readonly departmentId: string;
  readonly classId: string;
  readonly sectionId: string | null;
  readonly payload: ReportCardSnapshot;
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
  };
}
