import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import type { Band } from "@vidya/module-results";
import {
  assessments,
  assessmentTypes,
  marks,
  schTerms,
} from "./db/schema";
import {
  POLICY_VERSION,
  type AssessmentDefinition,
  type AssessmentEntry,
  type AssessmentTypeWeight,
  type CalculationPolicy,
  type WithinTypeAggregation,
} from "./aggregation";

/**
 * The school-academics READ MODEL for term results (the S01 integration seam).
 *
 * This is the only way another module may obtain a student's term marks and
 * the policy that governs them. It exists so the reporting module can build a
 * report card WITHOUT importing `sca_` tables or re-implementing the weighted
 * calculation (Constitution rule 2; gate-04's explicit instruction that "the
 * report-card integration assignment must source trusted enrollments,
 * calendars, marks and policies rather than duplicating these calculations").
 *
 * It returns SOURCE FACTS shaped for `calculateWeightedResult`, not a computed
 * result. The consumer runs the engine itself, so there is exactly one
 * implementation of the arithmetic and the caller can see the inputs that
 * produced a figure.
 *
 * AUTHORIZATION IS NOT PERFORMED HERE. Like every other read model in this
 * codebase, this returns records for a resolved id; the calling handler is
 * responsible for the scope check before it asks. The term is carried on the
 * result so the caller can authorize against the real college/department.
 */

/**
 * The default within-type aggregation for a school term.
 *
 * Indian school practice is normally to total the marks earned across a
 * type's assessments and divide by the total possible (a 20-mark and a
 * 50-mark unit test are not weighted equally) — that is `earned-points`.
 *
 * This is deliberately a named constant rather than a per-term column: making
 * it configurable is a real product decision that needs a school to ask for
 * it. The chosen value is recorded on every snapshot, so a later per-term
 * setting can be introduced without making existing report cards ambiguous.
 */
export const DEFAULT_WITHIN_TYPE_AGGREGATION: WithinTypeAggregation = "earned-points";

export interface SchoolTermRecord {
  readonly id: string;
  readonly collegeId: string;
  readonly departmentId: string;
  readonly name: string;
  readonly academicYear: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: "open" | "closed";
  /** The grading basis frozen onto the term by its first assessment. Null
   *  until then — a term with no assessments has no grade bands yet. */
  readonly gradeBands: readonly Band[] | null;
}

/** One subject's assessments and this student's entries, ready for S01. */
export interface SchoolSubjectSource {
  readonly subjectId: string;
  readonly assessments: readonly AssessmentDefinition[];
  /** Exactly one entry per assessment above. A student with no stored mark
   *  yields status "missing" — never an invented zero. */
  readonly entries: readonly AssessmentEntry[];
}

export interface SchoolTermResultSource {
  readonly term: SchoolTermRecord;
  /** The term's assessment-type weights, as the policy requires them. */
  readonly typeWeights: readonly AssessmentTypeWeight[];
  readonly subjects: readonly SchoolSubjectSource[];
}

export interface SchoolAcademicsReadModel {
  getTerm(termId: string): Promise<SchoolTermRecord | null>;
  /**
   * Every assessment in `classId` for `termId`, grouped by subject, with this
   * student's stored marks attached. Subjects with no assessments at all do
   * not appear — there is nothing to report on them.
   */
  termResultSource(
    studentId: string,
    classId: string,
    termId: string,
  ): Promise<SchoolTermResultSource | null>;
}

/**
 * Builds the S01 policy for a term. `absent`/`exempt`/`missing` are all
 * "block" because that is the only treatment v1 implements — a student with
 * an unrecorded assessment has no defensible subject percentage, and
 * inventing one is exactly the failure mode a report card must not have.
 */
export function schoolCalculationPolicy(
  typeWeights: readonly AssessmentTypeWeight[],
  withinTypeAggregation: WithinTypeAggregation = DEFAULT_WITHIN_TYPE_AGGREGATION,
): CalculationPolicy {
  return {
    version: POLICY_VERSION,
    typeWeights,
    withinTypeAggregation,
    absentTreatment: "block",
    exemptTreatment: "block",
    missingTreatment: "block",
  };
}

function termRecord(row: typeof schTerms.$inferSelect): SchoolTermRecord {
  return {
    id: row.id,
    collegeId: row.collegeId,
    departmentId: row.departmentId,
    name: row.name,
    academicYear: row.academicYear,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status as "open" | "closed",
    gradeBands: row.gradeBands ?? null,
  };
}

export function createSchoolAcademicsReadModel(db: Db): SchoolAcademicsReadModel {
  return {
    async getTerm(termId) {
      const [row] = await db.select().from(schTerms).where(eq(schTerms.id, termId)).limit(1);
      return row ? termRecord(row) : null;
    },

    async termResultSource(studentId, classId, termId) {
      const [term] = await db.select().from(schTerms).where(eq(schTerms.id, termId)).limit(1);
      if (!term) return null;

      const rows = await db
        .select()
        .from(assessments)
        .where(and(eq(assessments.classId, classId), eq(assessments.termId, termId)))
        .orderBy(asc(assessments.subjectId), asc(assessments.heldOn), asc(assessments.name));

      const types = await db
        .select()
        .from(assessmentTypes)
        .where(eq(assessmentTypes.termId, termId))
        .orderBy(asc(assessmentTypes.name));

      // One query for every mark this student holds across the term's
      // assessments, rather than one per assessment.
      const assessmentIds = rows.map((row) => row.id);
      const stored =
        assessmentIds.length === 0
          ? []
          : await db
              .select()
              .from(marks)
              .where(and(eq(marks.studentId, studentId), inArray(marks.assessmentId, assessmentIds)));
      const scoreByAssessment = new Map(stored.map((row) => [row.assessmentId, Number(row.score)]));

      const bySubject = new Map<string, { assessments: AssessmentDefinition[]; entries: AssessmentEntry[] }>();
      for (const row of rows) {
        let bucket = bySubject.get(row.subjectId);
        if (!bucket) {
          bucket = { assessments: [], entries: [] };
          bySubject.set(row.subjectId, bucket);
        }
        bucket.assessments.push({ id: row.id, typeId: row.typeId, maxScore: Number(row.maxScore) });
        const score = scoreByAssessment.get(row.id);
        bucket.entries.push(
          score === undefined
            ? { assessmentId: row.id, status: "missing" }
            : { assessmentId: row.id, status: "scored", score },
        );
      }

      return {
        term: termRecord(term),
        typeWeights: types.map((type) => ({ typeId: type.id, weight: type.weight })),
        subjects: [...bySubject.entries()].map(([subjectId, bucket]) => ({
          subjectId,
          assessments: bucket.assessments,
          entries: bucket.entries,
        })),
      };
    },
  };
}
