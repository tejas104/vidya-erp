import { describe, expect, it } from "vitest";
import { marksCsvTemplate, previewMarksCsv } from "./schoolMarksCsv";
import type { SchoolMarkView } from "./api";

const roster = [
  { id: "stu_a", admissionNo: "A-1", fullName: "A, Student" },
  { id: "stu_b", admissionNo: "B-2", fullName: "B Student" },
];
const existing: SchoolMarkView[] = [{ id: "mark_1", assessmentId: "a", studentId: "stu_a", score: 10, percentage: 50, grade: "C", points: 2, recordedBy: "teacher", updatedAt: "2026-09-25T00:00:00Z" }];

describe("school marks CSV preview", () => {
  it("round trips an Excel-style roster template and detects only changed scores", () => {
    const csv = marksCsvTemplate(roster, existing).replace('"stu_a","A-1","A, Student",10', '"stu_a","A-1","A, Student",12.50')
      .replace('"stu_b","B-2","B Student",', '"stu_b","B-2","B Student",0');
    const preview = previewMarksCsv(`\uFEFF${csv}`, roster, existing, 20);
    expect(preview.issues).toEqual([]);
    expect(preview.changes).toMatchObject([{ studentId: "stu_a", before: 10, after: 12.5 }, { studentId: "stu_b", before: null, after: 0 }]);
  });

  it("blocks mismatched, duplicate, missing, and out-of-range pupil rows", () => {
    const csv = ["student_id,admission_no,student_name,score", "stu_a,WRONG,A Student,22", "stu_a,A-1,A Student,12", "other,X,Unknown,8"].join("\r\n");
    const preview = previewMarksCsv(csv, roster, existing, 20);
    expect(preview.changes).toEqual([]);
    expect(preview.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("Admission number"),
      expect.stringContaining("more than once"),
      expect.stringContaining("not in this section"),
      expect.stringContaining("missing from the file"),
    ]));
  });

  it("rejects malformed and over-precise scores before any write", () => {
    expect(previewMarksCsv("student_id,admission_no,student_name,score\nstu_a,A-1,A,1.234\nstu_b,B-2,B,", roster, existing, 20).issues[0]?.message).toContain("two decimal");
    expect(() => previewMarksCsv("student_id,score\nstu_a,5", roster, existing, 20)).toThrow("downloaded template");
    expect(() => previewMarksCsv('student_id,admission_no,student_name,score\n"stu_a,A-1,A,5', roster, existing, 20)).toThrow("unfinished quoted");
  });
});
