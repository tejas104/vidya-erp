import { describe, expect, it } from "vitest";
import {
  MarksService,
  ScoreExceedsMaxError,
  SubjectOutsideDepartmentError,
  UnknownClassError,
} from "./marks-service";
import { InvalidEntriesError } from "./attendance-service";
import { DuplicateAssessmentError, MarksExistError } from "../repo/marks-repo";
import { FakePeopleDirectory, InMemoryMarksRepo, ORG } from "../../test-support/fakes";

function makeService() {
  const repo = new InMemoryMarksRepo();
  const service = new MarksService({ repo, directory: new FakePeopleDirectory() });
  return { service, repo };
}

const baseAssessment = {
  classId: ORG.classId,
  subjectId: ORG.mathId,
  kind: "exam" as const,
  name: "Midterm",
  academicYear: "2026-27",
  maxScore: 100,
  createdBy: "t-math",
};

describe("createAssessment", () => {
  it("stamps the class path and stores the taxonomy kind", async () => {
    const { service } = makeService();
    const created = await service.createAssessment(baseAssessment);
    expect(created).toMatchObject({
      collegeId: ORG.collegeId,
      departmentId: ORG.departmentId,
      classId: ORG.classId,
      subjectId: ORG.mathId,
      kind: "exam",
    });
    expect(Number(created.maxScore)).toBe(100);
  });

  it("rejects unknown classes and subjects, and cross-department subjects", async () => {
    const { service } = makeService();
    await expect(
      service.createAssessment({ ...baseAssessment, classId: "cls_ghost" }),
    ).rejects.toThrow(UnknownClassError);
    await expect(
      service.createAssessment({ ...baseAssessment, subjectId: "sub_ghost" }),
    ).rejects.toThrow(UnknownClassError);

    const otherDeptDirectory = new FakePeopleDirectory();
    otherDeptDirectory.subjectDepartment = async () => "dep_other";
    const crossed = new MarksService({
      repo: new InMemoryMarksRepo(),
      directory: otherDeptDirectory,
    });
    await expect(crossed.createAssessment(baseAssessment)).rejects.toThrow(
      SubjectOutsideDepartmentError,
    );
  });

  it("refuses duplicate names per class/subject/year; delete blocks on marks", async () => {
    const { service } = makeService();
    const created = await service.createAssessment(baseAssessment);
    await expect(service.createAssessment(baseAssessment)).rejects.toThrow(
      DuplicateAssessmentError,
    );
    await service.enterMarks(created, [{ studentId: ORG.studentA1, score: 50 }], "t-math");
    await expect(service.deleteAssessment(created.id)).rejects.toThrow(MarksExistError);
    expect(await service.deleteAssessment("asm_ghost")).toBe(false);
  });
});

describe("enterMarks (all-or-nothing marksheet)", () => {
  it("upserts and reports per-entry diffs", async () => {
    const { service } = makeService();
    const assessment = await service.createAssessment(baseAssessment);
    const first = await service.enterMarks(
      assessment,
      [
        { studentId: ORG.studentA1, score: 72 },
        { studentId: ORG.studentA2, score: 45 },
      ],
      "t-math",
    );
    expect(first).toEqual([
      { studentId: ORG.studentA1, before: null, after: 72, changed: true },
      { studentId: ORG.studentA2, before: null, after: 45, changed: true },
    ]);
    const second = await service.enterMarks(
      assessment,
      [
        { studentId: ORG.studentA1, score: 75 },
        { studentId: ORG.studentA2, score: 45 },
      ],
      "t-math",
    );
    expect(second).toEqual([
      { studentId: ORG.studentA1, before: 72, after: 75, changed: true },
      { studentId: ORG.studentA2, before: 45, after: 45, changed: false },
    ]);
  });

  it("rejects the whole batch on any invalid entry (range, enrollment, duplicates)", async () => {
    const { service, repo } = makeService();
    const assessment = await service.createAssessment(baseAssessment);
    try {
      await service.enterMarks(
        assessment,
        [
          { studentId: ORG.studentA1, score: 101 }, // over max
          { studentId: ORG.studentB1, score: 50 }, // section B is still cls_10a — enrolled ✓
          { studentId: "stu_ghost", score: 10 }, // unknown
          { studentId: ORG.studentA2, score: 40 },
          { studentId: ORG.studentA2, score: 41 }, // duplicate
        ],
        "t-math",
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEntriesError);
      const invalid = (error as InvalidEntriesError).invalid;
      expect(invalid.map((row) => row.studentId).sort()).toEqual([
        ORG.studentA1,
        ORG.studentA2,
        "stu_ghost",
      ]);
    }
    expect(repo.marks.size).toBe(0);
  });

  it("rejects students enrolled in a different class", async () => {
    const { service } = makeService();
    const directory = new FakePeopleDirectory();
    directory.studentPosition = async () => ({
      collegeId: ORG.collegeId,
      departmentId: ORG.departmentId,
      classId: ORG.otherClassId,
    });
    const crossed = new MarksService({ repo: new InMemoryMarksRepo(), directory });
    const assessment = await service.createAssessment(baseAssessment);
    await expect(
      crossed.enterMarks(assessment, [{ studentId: ORG.studentA1, score: 10 }], "t-math"),
    ).rejects.toThrow(InvalidEntriesError);
  });
});

describe("correctMark", () => {
  it("enforces maxScore and returns the before/after diff", async () => {
    const { service } = makeService();
    const assessment = await service.createAssessment(baseAssessment);
    await service.enterMarks(assessment, [{ studentId: ORG.studentA1, score: 72 }], "t-math");
    const mark = (await service.marksForAssessment(assessment.id))[0]!;
    const diff = await service.correctMark(mark, assessment, 80, "t-math");
    expect(diff).toEqual({ before: 72, after: 80 });
    await expect(service.correctMark(mark, assessment, 150, "t-math")).rejects.toThrow(
      ScoreExceedsMaxError,
    );
  });
});

describe("reads", () => {
  it("filters a student's marks by year and subject", async () => {
    const { service } = makeService();
    const math = await service.createAssessment(baseAssessment);
    const physics = await service.createAssessment({
      ...baseAssessment,
      subjectId: ORG.physicsId,
      name: "Physics Quiz",
      kind: "quiz",
    });
    await service.enterMarks(math, [{ studentId: ORG.studentA1, score: 72 }], "t-math");
    await service.enterMarks(physics, [{ studentId: ORG.studentA1, score: 60 }], "t-phys");

    const all = await service.marksForStudent(ORG.studentA1, {});
    expect(all).toHaveLength(2);
    const mathOnly = await service.marksForStudent(ORG.studentA1, { subjectId: ORG.mathId });
    expect(mathOnly).toHaveLength(1);
    expect(await service.marksForStudent(ORG.studentA1, { academicYear: "2025-26" })).toHaveLength(0);
    expect(await service.studentExists(ORG.studentA1)).toBe(true);
    expect(await service.studentExists("stu_ghost")).toBe(false);
  });
});
