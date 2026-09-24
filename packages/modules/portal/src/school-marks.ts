import type { PeopleDirectory } from "@vidya/module-people";
import {
  calculateWeightedResult,
  schoolCalculationPolicy,
  type SchoolTermResultSource,
} from "@vidya/module-school-academics";

/** The school portal uses the same weighted engine and missing-mark policy as report cards. */
export async function schoolTermMarks(source: SchoolTermResultSource, directory: PeopleDirectory) {
  const names = await directory.namesFor(source.subjects.map((subject) => subject.subjectId));
  const policy = schoolCalculationPolicy(source.typeWeights);
  const subjects = source.subjects.map((subject) => {
    const outcome = calculateWeightedResult({ policy, assessments: subject.assessments, entries: subject.entries });
    const entries = new Map(subject.entries.map((entry) => [entry.assessmentId, entry]));
    return {
      subjectId: subject.subjectId,
      name: names.get(subject.subjectId) ?? subject.subjectId,
      percentage: outcome.ok ? outcome.result.finalPercentage : null,
      status: outcome.ok ? "complete" as const : outcome.code === "incomplete" ? "incomplete" as const : "unavailable" as const,
      recordedCount: subject.entries.filter((entry) => entry.status === "scored").length,
      assessmentCount: subject.assessments.length,
      assessments: subject.assessments.map((assessment) => {
        const entry = entries.get(assessment.id);
        return {
          assessmentId: assessment.id,
          name: assessment.name,
          typeName: assessment.typeName,
          heldOn: assessment.heldOn,
          maxScore: assessment.maxScore,
          score: entry?.status === "scored" ? entry.score ?? null : null,
          status: entry?.status ?? "missing",
        };
      }),
    };
  });
  const complete = subjects.length > 0 && subjects.every((subject) => subject.status === "complete");
  const overallPct = complete
    ? Math.round((subjects.reduce((sum, subject) => sum + (subject.percentage ?? 0), 0) / subjects.length) * 100) / 100
    : null;
  return {
    termId: source.term.id,
    termName: source.term.name,
    academicYear: source.term.academicYear,
    endsOn: source.term.endsOn,
    overallPct,
    complete,
    subjects,
  };
}
