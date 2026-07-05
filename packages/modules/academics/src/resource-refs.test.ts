import { describe, expect, it } from "vitest";
import { attendanceRef, marksRef } from "./resource-refs";

const position = {
  collegeId: "col_1",
  departmentId: "dep_1",
  classId: "cls_1",
} as const;

describe("resource-ref builders (the ADR-0017 distinction)", () => {
  it("attendance refs NEVER carry a subjectId", () => {
    const ref = attendanceRef({ ...position, sectionId: "sec_1" });
    expect(ref).toEqual({
      module: "academics",
      resourceType: "attendance-record",
      org: { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" },
    });
    expect("subjectId" in ref).toBe(false);
  });

  it("marks refs ALWAYS carry the subjectId and anchor at class level", () => {
    const ref = marksRef({ ...position, subjectId: "sub_math" });
    expect(ref).toEqual({
      module: "academics",
      resourceType: "marks",
      org: { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" },
      subjectId: "sub_math",
    });
    expect(ref.org).not.toHaveProperty("sectionId");
  });

  it("assessment refs share the marks shape with their own resourceType", () => {
    const ref = marksRef({ ...position, subjectId: "sub_math" }, "assessment");
    expect(ref.resourceType).toBe("assessment");
    expect(ref.subjectId).toBe("sub_math");
  });
});
