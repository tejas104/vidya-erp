import {
  SCHOOL_ATTENDANCE_ENGINE_VERSION,
  SCHOOL_ATTENDANCE_POLICY_VERSION,
  SCHOOL_DAILY_ATTENDANCE_POLICY,
  summarizeAttendance,
  type AcademicsReadModel,
  type AttendancePolicy,
  type AttendanceRecord,
  type RecordedAttendanceStatus,
} from "@vidya/module-academics";
import {
  DEFAULT_WITHIN_TYPE_AGGREGATION,
  SCHOOL_RESULT_ENGINE_VERSION,
  SCHOOL_RESULT_POLICY_VERSION,
  calculateWeightedResult,
  schoolCalculationPolicy,
  type SchoolAcademicsReadModel,
  type SchoolTermResultSource,
} from "@vidya/module-school-academics";
import { bandFor } from "@vidya/module-results";
import type { PeopleDirectory } from "@vidya/module-people";
import {
  SNAPSHOT_VERSION,
  type ReportCardPreview,
  type ReportCardSnapshot,
} from "./report-card-contract";

/**
 * Builds school report cards by COMPOSING the two existing calculation
 * engines. It contains no arithmetic of its own beyond assembling their
 * outputs, and it reads no other module's tables — the S01 weighted-result
 * engine and the S02 attendance-summary engine are reached through their
 * modules' public APIs, and the source facts through those modules' read
 * models (gate-04's standing instruction).
 *
 * MISSING DATA IS NEVER FILLED IN. When S01 reports a subject incomplete, the
 * subject's percentage stays null and a warning is raised; it is not computed
 * as if the missing assessment did not exist, and never as a zero. When
 * attendance is incomplete, S02 already returns a null percentage with the
 * missing dates named, and that is passed through unchanged.
 */

/**
 * The attendance treatments applied to a school report card.
 *
 * Deliberately a constant, not a per-school setting: making it configurable
 * is a real product decision that needs a school to ask for it. Every value
 * here is recorded on the snapshot's provenance, so introducing a per-term
 * setting later cannot make an already-issued card ambiguous.
 *
 * - `late` counts as present: a pupil who attended is present, and lateness is
 *   a discipline matter rather than an attendance one.
 * - `excused` leaves the denominator entirely: approved leave is not held
 *   against a pupil's attendance percentage.
 * - `half-day` earns half credit.
 */
export const SCHOOL_ATTENDANCE_POLICY: AttendancePolicy = {
  ...SCHOOL_DAILY_ATTENDANCE_POLICY,
};

export interface ReportCardSources {
  readonly schoolAcademics: SchoolAcademicsReadModel;
  readonly academics: AcademicsReadModel;
  readonly directory: PeopleDirectory;
}

export interface BuildPreviewInput {
  readonly studentId: string;
  readonly termId: string;
  readonly classId: string;
  readonly sectionId: string | null;
}

export class ReportCardBuildError extends Error {
  constructor(
    readonly status: 404 | 422,
    message: string,
  ) {
    super(message);
    this.name = "ReportCardBuildError";
  }
}

export class ReportCardBuilder {
  constructor(private readonly sources: ReportCardSources) {}

  /**
   * Computes the report card for one student. Pure with respect to storage:
   * calling it twice changes nothing, so the preview route and the generate
   * route compute identically and a snapshot always matches what the user
   * approved on screen.
   */
  async build(input: BuildPreviewInput): Promise<ReportCardSnapshot> {
    const source = await this.sources.schoolAcademics.termResultSource(
      input.studentId,
      input.classId,
      input.termId,
    );
    if (source === null) throw new ReportCardBuildError(404, "no such term");

    const brief = await this.sources.directory.studentsBrief([input.studentId]);
    const student = brief.get(input.studentId);
    if (student === undefined) throw new ReportCardBuildError(404, "no such student");

    const warnings: string[] = [];
    const subjects = await this.buildSubjects(source, warnings);
    const overall = this.buildOverall(source, subjects, warnings);
    const attendance = await this.buildAttendance(input, source, warnings);

    return {
      snapshotVersion: SNAPSHOT_VERSION,
      student: { id: input.studentId, fullName: student.fullName, admissionNo: student.admissionNo },
      term: {
        id: source.term.id,
        name: source.term.name,
        academicYear: source.term.academicYear,
        startsOn: source.term.startsOn,
        endsOn: source.term.endsOn,
      },
      subjects,
      overall,
      attendance,
      warnings,
      provenance: {
        resultPolicyVersion: SCHOOL_RESULT_POLICY_VERSION,
        resultEngineVersion: SCHOOL_RESULT_ENGINE_VERSION,
        attendancePolicyVersion: SCHOOL_ATTENDANCE_POLICY_VERSION,
        attendanceEngineVersion: SCHOOL_ATTENDANCE_ENGINE_VERSION,
        withinTypeAggregation: DEFAULT_WITHIN_TYPE_AGGREGATION,
        lateTreatment: SCHOOL_ATTENDANCE_POLICY.lateTreatment,
        excusedTreatment: SCHOOL_ATTENDANCE_POLICY.excusedTreatment,
        halfDayTreatment: SCHOOL_ATTENDANCE_POLICY.halfDayTreatment,
      },
    };
  }

  private async buildSubjects(
    source: SchoolTermResultSource,
    warnings: string[],
  ): Promise<ReportCardPreview["subjects"]> {
    const names = await this.sources.directory.namesFor(
      source.subjects.map((subject) => subject.subjectId),
    );
    const bands = source.term.gradeBands;
    const policy = schoolCalculationPolicy(source.typeWeights);

    if (source.subjects.length === 0) {
      warnings.push("This term has no assessments for this class, so there are no subject results.");
    }
    if (bands === null && source.subjects.length > 0) {
      warnings.push("This term has no saved grading basis, so no letter grades can be shown.");
    }

    return source.subjects.map((subject) => {
      const subjectName = names.get(subject.subjectId) ?? subject.subjectId;
      const outcome = calculateWeightedResult({
        policy,
        assessments: subject.assessments,
        entries: subject.entries,
      });

      if (!outcome.ok) {
        // "incomplete" is the ordinary case of a pupil missing a mark. Every
        // other failure code means the term's own configuration is wrong, and
        // that must be reported as a distinct problem rather than blamed on
        // the pupil.
        warnings.push(
          outcome.code === "incomplete"
            ? `${subjectName} has no final percentage because some assessments have no recorded mark.`
            : `${subjectName} could not be calculated (${outcome.code}): ${outcome.issues[0]?.message ?? "invalid term configuration"}`,
        );
        return {
          subjectId: subject.subjectId,
          subjectName,
          percentage: null,
          grade: null,
          complete: false,
        };
      }

      const percentage = outcome.result.finalPercentage;
      return {
        subjectId: subject.subjectId,
        subjectName,
        percentage,
        grade: bands === null ? null : bandFor(bands, percentage).grade,
        complete: true,
      };
    });
  }

  /**
   * The overall figure is the unweighted mean of the COMPLETE subject
   * percentages, and it is reported complete only when every subject is
   * complete. A mean taken over a subset would silently answer a different
   * question than the one the reader is asking.
   */
  private buildOverall(
    source: SchoolTermResultSource,
    subjects: ReportCardPreview["subjects"],
    warnings: string[],
  ): ReportCardPreview["overall"] {
    const complete = subjects.every((subject) => subject.complete) && subjects.length > 0;
    if (!complete) {
      if (subjects.length > 0) {
        warnings.push("The overall result is unavailable until every subject has a complete set of marks.");
      }
      return { percentage: null, grade: null, complete: false };
    }
    const total = subjects.reduce((sum, subject) => sum + (subject.percentage ?? 0), 0);
    const percentage = Math.round((total / subjects.length) * 100) / 100;
    const bands = source.term.gradeBands;
    return {
      percentage,
      grade: bands === null ? null : bandFor(bands, percentage).grade,
      complete: true,
    };
  }

  private async buildAttendance(
    input: BuildPreviewInput,
    source: SchoolTermResultSource,
    warnings: string[],
  ): Promise<ReportCardPreview["attendance"]> {
    const empty = {
      eligibleDays: 0,
      presentEquivalentDays: null,
      percentage: null,
      complete: false,
      missingDates: [],
    };

    if (input.sectionId === null) {
      warnings.push("This pupil is not enrolled in a section, so attendance cannot be summarized.");
      return empty;
    }

    const days = await this.sources.academics.sectionDailyRegisterWindow(
      input.sectionId,
      source.term.startsOn,
      source.term.endsOn,
    );
    if (days.length === 0 && source.term.instructionalDays == null) {
      warnings.push("No attendance registers were taken for this section during the term.");
      return empty;
    }

    // A day on which the section's register was taken is an instructional day
    // by evidence. The pupil's own entry on that day is their record; a day
    // with no entry for them is a register that was never completed, which
    // S02 reports separately from an absence.
    const records: AttendanceRecord[] = [];
    for (const day of days) {
      const entry = day.entries.find((candidate) => candidate.studentId === input.studentId);
      if (entry !== undefined) {
        records.push({ date: day.heldOn, status: entry.status as RecordedAttendanceStatus });
      }
    }

    const outcome = summarizeAttendance({
      policy: SCHOOL_ATTENDANCE_POLICY,
      interval: { from: source.term.startsOn, to: source.term.endsOn },
      calendar: { instructionalDays: source.term.instructionalDays ?? days.map((day) => day.heldOn) },
      // The term window is the enrollment span we can defend from attendance
      // evidence alone. A mid-term admission or transfer is not yet modelled;
      // its effect is visible as missing dates rather than hidden.
      enrollments: [{ from: source.term.startsOn, to: source.term.endsOn }],
      records,
    });

    if (!outcome.ok) {
      warnings.push(
        `Attendance could not be summarized (${outcome.code}): ${outcome.issues[0]?.message ?? "inconsistent attendance data"}`,
      );
      return empty;
    }

    const result = outcome.result;
    if (!result.complete) {
      warnings.push(
        `Attendance is incomplete: ${result.missingDays} of ${result.expectedDays} instructional days have no register entry for this pupil.`,
      );
    }
    return {
      eligibleDays: result.percentageDenominator,
      presentEquivalentDays: result.presentEquivalentDays,
      percentage: result.percentage,
      complete: result.complete,
      missingDates: [...result.missingDates],
    };
  }
}
