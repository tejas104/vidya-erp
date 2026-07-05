import { describe, expect, it } from "vitest";
import type { Principal, RedisClient, ScopeGrant } from "@vidya/platform";
import { createIdentityCore } from "@vidya/module-identity";
import { attendanceRef, marksRef } from "./resource-refs";
import { ORG } from "../test-support/fakes";

/**
 * THE WORKED SCOPE TRACES (assignment #4 security-review requirement),
 * executed against the REAL human-owned ScopeChecker — not a double — with
 * ResourceRefs built by this module's actual ref builders. Each trace
 * below appears verbatim in docs/security-review.md; a human must verify
 * this file against the matrix (ADR-0010/0013) as part of acceptance.
 *
 * createIdentityCore only needs Redis for the SessionManager, which these
 * traces never touch; the checker itself is pure.
 */

const core = createIdentityCore({
  redis: {} as RedisClient, // never used by the ScopeChecker
  session: { ttlHours: 1, idleMinutes: 1 },
});
const checker = core.scopeChecker;

function caller(id: string, roles: Principal["roles"], grants: ScopeGrant[]): Principal {
  return { id, kind: "user", displayName: id, roles, scopes: [], grants, sessionId: "s" };
}

// Grants exactly as #3's derivation mints them: class-level, subject for
// subject teachers, none for class teachers.
const mathTeacher = caller("t-math", ["teacher"], [
  {
    role: "teacher",
    org: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId },
    subjectId: ORG.mathId,
  },
]);
const classTeacher = caller("ct-1", ["class_teacher"], [
  {
    role: "class_teacher",
    org: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId },
  },
]);
const hod = caller("h-1", ["hod"], [
  { role: "hod", org: { collegeId: ORG.collegeId, departmentId: ORG.departmentId } },
]);
const principal = caller("p-1", ["principal"], [
  { role: "principal", org: { collegeId: ORG.collegeId } },
]);
const admin = caller("a-1", ["admin"], [{ role: "admin", org: { collegeId: ORG.collegeId } }]);

const attendanceInSectionA = attendanceRef({
  collegeId: ORG.collegeId,
  departmentId: ORG.departmentId,
  classId: ORG.classId,
  sectionId: ORG.sectionA,
});
const attendanceInSectionB = attendanceRef({
  collegeId: ORG.collegeId,
  departmentId: ORG.departmentId,
  classId: ORG.classId,
  sectionId: ORG.sectionB,
});
const mathMarks = marksRef({
  collegeId: ORG.collegeId,
  departmentId: ORG.departmentId,
  classId: ORG.classId,
  subjectId: ORG.mathId,
});
const physicsMarks = marksRef({
  collegeId: ORG.collegeId,
  departmentId: ORG.departmentId,
  classId: ORG.classId,
  subjectId: ORG.physicsId,
});

describe("worked scope traces against the REAL matrix (assignment #4 list)", () => {
  it("TRACE 1 — teacher reads own-subject marks across their class: GRANTED", () => {
    const decision = checker.check(mathTeacher, "read", mathMarks);
    expect(decision.granted).toBe(true);
    expect(decision.matchedGrant?.subjectId).toBe(ORG.mathId);
  });

  it("TRACE 2 — teacher reads another subject's marks in the same class: DENIED", () => {
    const decision = checker.check(mathTeacher, "read", physicsMarks);
    expect(decision.granted).toBe(false);
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it("TRACE 3 — teacher reads attendance across their class's sections: GRANTED", () => {
    // Attendance carries no subjectId, and the class-level grant covers
    // every section of the class — both sections are readable.
    expect(checker.check(mathTeacher, "read", attendanceInSectionA).granted).toBe(true);
    expect(checker.check(mathTeacher, "read", attendanceInSectionB).granted).toBe(true);
  });

  it("TRACE 4 — teacher writes marks for a subject not theirs: DENIED", () => {
    expect(checker.check(mathTeacher, "update", physicsMarks).granted).toBe(false);
    expect(checker.check(mathTeacher, "create", physicsMarks).granted).toBe(false);
  });

  it("TRACE 4b — teacher writes own-subject marks in their class: GRANTED (the working path)", () => {
    expect(checker.check(mathTeacher, "create", mathMarks).granted).toBe(true);
    expect(checker.check(mathTeacher, "update", mathMarks).granted).toBe(true);
  });

  it("TRACE 4c — teacher cannot write attendance (non-subject record): DENIED", () => {
    expect(checker.check(mathTeacher, "create", attendanceInSectionA).granted).toBe(false);
    expect(checker.check(mathTeacher, "update", attendanceInSectionA).granted).toBe(false);
  });

  it("TRACE 5 — class_teacher writes attendance: GRANTED; writes marks: DENIED", () => {
    expect(checker.check(classTeacher, "create", attendanceInSectionA).granted).toBe(true);
    expect(checker.check(classTeacher, "update", attendanceInSectionA).granted).toBe(true);
    expect(checker.check(classTeacher, "create", mathMarks).granted).toBe(false);
    expect(checker.check(classTeacher, "update", mathMarks).granted).toBe(false);
    // ... though they read every subject's marks in their class.
    expect(checker.check(classTeacher, "read", mathMarks).granted).toBe(true);
    expect(checker.check(classTeacher, "read", physicsMarks).granted).toBe(true);
  });

  it("TRACE 6 — hod and principal read marks and attendance: GRANTED; routine writes: DENIED", () => {
    for (const reader of [hod, principal]) {
      expect(checker.check(reader, "read", mathMarks).granted).toBe(true);
      expect(checker.check(reader, "read", attendanceInSectionA).granted).toBe(true);
      expect(checker.check(reader, "update", mathMarks).granted).toBe(false);
      expect(checker.check(reader, "create", attendanceInSectionA).granted).toBe(false);
    }
  });

  it("TRACE 7 — admin reads academic data (support) but writes NONE of it: DENIED", () => {
    expect(checker.check(admin, "read", mathMarks).granted).toBe(true);
    expect(checker.check(admin, "read", attendanceInSectionA).granted).toBe(true);
    expect(checker.check(admin, "create", mathMarks).granted).toBe(false);
    expect(checker.check(admin, "update", mathMarks).granted).toBe(false);
    expect(checker.check(admin, "delete", mathMarks).granted).toBe(false);
    expect(checker.check(admin, "update", attendanceInSectionA).granted).toBe(false);
  });

  it("TRACE 8 — nothing crosses class or college boundaries", () => {
    const otherClassMarks = marksRef({
      collegeId: ORG.collegeId,
      departmentId: ORG.departmentId,
      classId: ORG.otherClassId,
      subjectId: ORG.mathId,
    });
    expect(checker.check(mathTeacher, "read", otherClassMarks).granted).toBe(false);
    expect(checker.check(classTeacher, "read", otherClassMarks).granted).toBe(false);

    const otherCollegeAttendance = attendanceRef({
      collegeId: "col_other",
      departmentId: ORG.departmentId,
      classId: ORG.classId,
      sectionId: ORG.sectionA,
    });
    expect(checker.check(principal, "read", otherCollegeAttendance).granted).toBe(false);
    expect(checker.check(admin, "read", otherCollegeAttendance).granted).toBe(false);
  });

  it("TRACE 9 — assessment creation is the subject teacher's write", () => {
    const mathAssessment = marksRef(
      {
        collegeId: ORG.collegeId,
        departmentId: ORG.departmentId,
        classId: ORG.classId,
        subjectId: ORG.mathId,
      },
      "assessment",
    );
    expect(checker.check(mathTeacher, "create", mathAssessment).granted).toBe(true);
    expect(checker.check(classTeacher, "create", mathAssessment).granted).toBe(false);
    expect(checker.check(admin, "create", mathAssessment).granted).toBe(false);
  });
});
