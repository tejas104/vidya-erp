import { describe, expect, it } from "vitest";
import type { AcademicsReadModel, SectionAttendanceDay } from "@vidya/module-academics";
import type {
  SchoolAcademicsReadModel,
  SchoolTermRecord,
  SchoolTermResultSource,
} from "@vidya/module-school-academics";
import type { PeopleDirectory } from "@vidya/module-people";
import { ReportCardBuildError, ReportCardBuilder } from "./report-card-service";

/**
 * Behavioral tests for report-card assembly.
 *
 * These assert what the report card SAYS for a given set of school facts —
 * above all that missing marks and missing registers are reported as missing
 * and never silently become zero, and that the figures come from the S01/S02
 * engines rather than from arithmetic invented here.
 */

const TERM: SchoolTermRecord = {
  id: "term-1",
  collegeId: "col-1",
  departmentId: "dep-1",
  name: "Term 1",
  academicYear: "2026-27",
  startsOn: "2026-06-01",
  endsOn: "2026-06-05",
  status: "open",
  marksReleasedAt: null,
  gradeBands: [
    { minPct: 0, grade: "F", points: 0 },
    { minPct: 40, grade: "C", points: 5 },
    { minPct: 60, grade: "B", points: 7 },
    { minPct: 80, grade: "A", points: 9 },
  ],
};

/** One assessment type carrying the whole 100% weight keeps these tests about
 *  assembly and completeness; S01 has its own weighting coverage. */
const ONE_TYPE = [{ typeId: "type-1", weight: 100 }];

function source(overrides: Partial<SchoolTermResultSource> = {}): SchoolTermResultSource {
  return {
    term: TERM,
    typeWeights: ONE_TYPE,
    subjects: [
      {
        subjectId: "sub-math",
        assessments: [{ id: "a1", typeId: "type-1", maxScore: 100, name: "Exam", heldOn: "2026-06-01", typeName: "Exam" }],
        entries: [{ assessmentId: "a1", status: "scored", score: 90 }],
      },
    ],
    ...overrides,
  };
}

function buildSources(opts: {
  source?: SchoolTermResultSource | null;
  days?: SectionAttendanceDay[];
  studentKnown?: boolean;
}) {
  const schoolAcademics: SchoolAcademicsReadModel = {
    getTerm: async () => TERM,
    listTermsForColleges: async () => [TERM],
    termResultSource: async () => (opts.source === undefined ? source() : opts.source),
  };
  const academics = {
    sectionAttendanceWindow: async () => opts.days ?? [],
    sectionDailyRegisterWindow: async () => opts.days ?? [],
  } as unknown as AcademicsReadModel;
  const directory = {
    studentsBrief: async () =>
      opts.studentKnown === false
        ? new Map()
        : new Map([["stu-1", { fullName: "Asha Kulkarni", admissionNo: "A-001" }]]),
    namesFor: async () =>
      new Map([
        ["sub-math", "Mathematics"],
        ["sub-sci", "Science"],
      ]),
  } as unknown as PeopleDirectory;
  return { schoolAcademics, academics, directory };
}

const INPUT = { studentId: "stu-1", termId: "term-1", classId: "cls-1", sectionId: "sec-1" };

/** Five instructional days; the pupil is present on each unless overridden. */
function fullAttendance(status: "present" | "absent" = "present"): SectionAttendanceDay[] {
  return ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"].map((heldOn) => ({
    heldOn,
    entries: [{ studentId: "stu-1", status }],
  }));
}

describe("ReportCardBuilder", () => {
  it("reports a complete subject with the grade from the term's own bands", async () => {
    const builder = new ReportCardBuilder(buildSources({ days: fullAttendance() }));
    const card = await builder.build(INPUT);

    expect(card.subjects).toEqual([
      {
        subjectId: "sub-math",
        subjectName: "Mathematics",
        percentage: 90,
        grade: "A",
        complete: true,
      },
    ]);
    expect(card.overall).toEqual({ percentage: 90, grade: "A", complete: true });
    expect(card.student).toEqual({ id: "stu-1", fullName: "Asha Kulkarni", admissionNo: "A-001" });
  });

  it("leaves a subject percentage null when a mark was never recorded — never zero", async () => {
    const builder = new ReportCardBuilder(
      buildSources({
        days: fullAttendance(),
        source: source({
          subjects: [
            {
              subjectId: "sub-math",
              assessments: [
                { id: "a1", typeId: "type-1", maxScore: 100, name: "Exam 1", heldOn: "2026-06-01", typeName: "Exam" },
                { id: "a2", typeId: "type-1", maxScore: 100, name: "Exam 2", heldOn: "2026-06-02", typeName: "Exam" },
              ],
              // a2 was never marked for this pupil.
              entries: [
                { assessmentId: "a1", status: "scored", score: 90 },
                { assessmentId: "a2", status: "missing" },
              ],
            },
          ],
        }),
      }),
    );
    const card = await builder.build(INPUT);

    const subject = card.subjects[0]!;
    expect(subject.complete).toBe(false);
    expect(subject.percentage).toBeNull();
    expect(subject.grade).toBeNull();
    // The specific failure that would be worst: averaging 90 and a phantom 0.
    expect(subject.percentage).not.toBe(45);
    expect(card.warnings.join(" ")).toContain("Mathematics");
  });

  it("withholds the overall result while any subject is incomplete", async () => {
    const builder = new ReportCardBuilder(
      buildSources({
        days: fullAttendance(),
        source: source({
          subjects: [
            {
              subjectId: "sub-math",
              assessments: [{ id: "a1", typeId: "type-1", maxScore: 100, name: "Exam", heldOn: "2026-06-01", typeName: "Exam" }],
              entries: [{ assessmentId: "a1", status: "scored", score: 90 }],
            },
            {
              subjectId: "sub-sci",
              assessments: [{ id: "a2", typeId: "type-1", maxScore: 100, name: "Exam", heldOn: "2026-06-01", typeName: "Exam" }],
              entries: [{ assessmentId: "a2", status: "missing" }],
            },
          ],
        }),
      }),
    );
    const card = await builder.build(INPUT);

    expect(card.overall).toEqual({ percentage: null, grade: null, complete: false });
    // Not the mean of the one subject that happened to be complete.
    expect(card.overall.percentage).not.toBe(90);
  });

  it("averages every subject once all are complete", async () => {
    const builder = new ReportCardBuilder(
      buildSources({
        days: fullAttendance(),
        source: source({
          subjects: [
            {
              subjectId: "sub-math",
              assessments: [{ id: "a1", typeId: "type-1", maxScore: 100, name: "Exam", heldOn: "2026-06-01", typeName: "Exam" }],
              entries: [{ assessmentId: "a1", status: "scored", score: 90 }],
            },
            {
              subjectId: "sub-sci",
              assessments: [{ id: "a2", typeId: "type-1", maxScore: 100, name: "Exam", heldOn: "2026-06-01", typeName: "Exam" }],
              entries: [{ assessmentId: "a2", status: "scored", score: 70 }],
            },
          ],
        }),
      }),
    );
    const card = await builder.build(INPUT);
    expect(card.overall).toEqual({ percentage: 80, grade: "A", complete: true });
  });

  it("separates an unsubmitted register from pupil absence", async () => {
    // Five instructional days; the pupil has entries on only three of them.
    // The other two are registers that were never completed for this pupil —
    // that is NOT two absences, and the percentage must not pretend otherwise.
    const days: SectionAttendanceDay[] = [
      { heldOn: "2026-06-01", entries: [{ studentId: "stu-1", status: "present" }] },
      { heldOn: "2026-06-02", entries: [{ studentId: "stu-1", status: "absent" }] },
      { heldOn: "2026-06-03", entries: [{ studentId: "stu-1", status: "present" }] },
      { heldOn: "2026-06-04", entries: [{ studentId: "other", status: "present" }] },
      { heldOn: "2026-06-05", entries: [{ studentId: "other", status: "present" }] },
    ];
    const builder = new ReportCardBuilder(buildSources({ days }));
    const card = await builder.build(INPUT);

    expect(card.attendance.complete).toBe(false);
    expect(card.attendance.percentage).toBeNull();
    expect(card.attendance.missingDates).toEqual(["2026-06-04", "2026-06-05"]);
    // 2/5 = 40% would be the wrong answer produced by treating the two
    // unsubmitted registers as absences.
    expect(card.attendance.percentage).not.toBe(40);
  });

  it("computes attendance when every register is complete", async () => {
    const days: SectionAttendanceDay[] = [
      { heldOn: "2026-06-01", entries: [{ studentId: "stu-1", status: "present" }] },
      { heldOn: "2026-06-02", entries: [{ studentId: "stu-1", status: "absent" }] },
      { heldOn: "2026-06-03", entries: [{ studentId: "stu-1", status: "present" }] },
      { heldOn: "2026-06-04", entries: [{ studentId: "stu-1", status: "present" }] },
      { heldOn: "2026-06-05", entries: [{ studentId: "stu-1", status: "late" }] },
    ];
    const builder = new ReportCardBuilder(buildSources({ days }));
    const card = await builder.build(INPUT);

    expect(card.attendance.complete).toBe(true);
    expect(card.attendance.missingDates).toEqual([]);
    // "late" counts as present under SCHOOL_ATTENDANCE_POLICY: 4 of 5.
    expect(card.attendance.eligibleDays).toBe(5);
    expect(card.attendance.presentEquivalentDays).toBe(4);
    expect(card.attendance.percentage).toBe(80);
  });

  it("removes approved leave from the denominator rather than penalising it", async () => {
    const days: SectionAttendanceDay[] = [
      { heldOn: "2026-06-01", entries: [{ studentId: "stu-1", status: "present" }] },
      { heldOn: "2026-06-02", entries: [{ studentId: "stu-1", status: "present" }] },
      { heldOn: "2026-06-03", entries: [{ studentId: "stu-1", status: "excused" }] },
      { heldOn: "2026-06-04", entries: [{ studentId: "stu-1", status: "present" }] },
      { heldOn: "2026-06-05", entries: [{ studentId: "stu-1", status: "present" }] },
    ];
    const builder = new ReportCardBuilder(buildSources({ days }));
    const card = await builder.build(INPUT);

    // 4 present out of 4 eligible days, not 4 out of 5.
    expect(card.attendance.eligibleDays).toBe(4);
    expect(card.attendance.percentage).toBe(100);
  });

  it("states that attendance is unavailable when no register was ever taken", async () => {
    const builder = new ReportCardBuilder(buildSources({ days: [] }));
    const card = await builder.build(INPUT);

    expect(card.attendance.percentage).toBeNull();
    expect(card.attendance.complete).toBe(false);
    expect(card.warnings.join(" ")).toContain("No attendance registers");
  });

  it("reports an unsectioned pupil rather than inventing an attendance figure", async () => {
    const builder = new ReportCardBuilder(buildSources({ days: fullAttendance() }));
    const card = await builder.build({ ...INPUT, sectionId: null });

    expect(card.attendance.percentage).toBeNull();
    expect(card.warnings.join(" ")).toContain("not enrolled in a section");
  });

  it("warns, rather than throwing, when the term has no grading basis", async () => {
    const builder = new ReportCardBuilder(
      buildSources({
        days: fullAttendance(),
        source: source({ term: { ...TERM, gradeBands: null } }),
      }),
    );
    const card = await builder.build(INPUT);

    expect(card.subjects[0]!.percentage).toBe(90);
    expect(card.subjects[0]!.grade).toBeNull();
    expect(card.warnings.join(" ")).toContain("no saved grading basis");
  });

  it("blames the term's configuration, not the pupil, when weights are invalid", async () => {
    const builder = new ReportCardBuilder(
      buildSources({
        days: fullAttendance(),
        // Weights that do not sum to 100 are a setup error; S01 rejects them
        // with a code other than "incomplete".
        source: source({ typeWeights: [{ typeId: "type-1", weight: 60 }] }),
      }),
    );
    const card = await builder.build(INPUT);

    expect(card.subjects[0]!.complete).toBe(false);
    expect(card.warnings.join(" ")).toContain("invalid-policy");
    expect(card.warnings.join(" ")).not.toContain("no recorded mark");
  });

  it("records the engine and policy versions that produced the figures", async () => {
    const builder = new ReportCardBuilder(buildSources({ days: fullAttendance() }));
    const card = await builder.build(INPUT);

    expect(card.provenance.resultEngineVersion).toBe("school-weighted-result.engine.v1");
    expect(card.provenance.attendanceEngineVersion).toBe("school-attendance-summary.engine.v1");
    expect(card.provenance.withinTypeAggregation).toBe("earned-points");
    expect(card.provenance.excusedTreatment).toBe("excluded-from-denominator");
    expect(card.snapshotVersion).toBe("school-report-card.snapshot.v1");
  });

  it("is repeatable: the same facts produce an identical card", async () => {
    const builder = new ReportCardBuilder(buildSources({ days: fullAttendance() }));
    const [first, second] = await Promise.all([builder.build(INPUT), builder.build(INPUT)]);
    // What the user previews must be exactly what generation stores.
    expect(first).toEqual(second);
  });

  it("refuses an unknown term and an unknown pupil", async () => {
    const noTerm = new ReportCardBuilder(buildSources({ source: null, days: [] }));
    await expect(noTerm.build(INPUT)).rejects.toBeInstanceOf(ReportCardBuildError);

    const noStudent = new ReportCardBuilder(
      buildSources({ days: fullAttendance(), studentKnown: false }),
    );
    await expect(noStudent.build(INPUT)).rejects.toThrow(/no such student/);
  });
});
