import { describe, expect, it } from "vitest";
import type { Principal, RedisClient, ScopeGrant } from "@vidya/platform";
import { createIdentityCore } from "@vidya/module-identity";
import {
  canReadAttendanceAgg,
  canReadCrossSubjectAgg,
  canReadMarksAgg,
  cohortSufficient,
} from "./aggregation-scope";
import { ORG, paths } from "../test-support/fakes";

/**
 * THE WORKED AGGREGATION-SCOPE EXAMPLES (assignment #5 security-review
 * requirement), executed against the REAL human-owned ScopeChecker. These
 * are the examples the human verifies (docs/review-gate-5.md); each also
 * appears in docs/security-review.md.
 *
 * The scenario: a math teacher and the class's class_teacher, hod,
 * principal and admin — exactly the grants #3's derivation mints.
 */

const core = createIdentityCore({
  redis: {} as RedisClient, // the checker is pure; Redis is never touched
  session: { ttlHours: 1, idleMinutes: 1 },
});
const checker = core.scopeChecker;

function caller(id: string, roles: Principal["roles"], grants: ScopeGrant[]): Principal {
  return { id, kind: "user", displayName: id, roles, scopes: [], grants, sessionId: "s" };
}

const mathTeacher = caller("t-math", ["teacher"], [
  { role: "teacher", org: paths.class, subjectId: ORG.mathId },
]);
const classTeacher = caller("ct-1", ["class_teacher"], [
  { role: "class_teacher", org: paths.class },
]);
const hod = caller("h-1", ["hod"], [{ role: "hod", org: paths.department }]);
const principal = caller("p-1", ["principal"], [{ role: "principal", org: paths.college }]);
const admin = caller("a-1", ["admin"], [{ role: "admin", org: paths.college }]);

const BOTH_SUBJECTS = [ORG.mathId, ORG.physicsId];

describe("worked example 1 — a teacher's dashboard is computed only from their scope", () => {
  it("teacher: own-subject class average GRANTED; other subject's DENIED", () => {
    expect(canReadMarksAgg(checker, mathTeacher, paths.class, ORG.mathId)).toBe(true);
    expect(canReadMarksAgg(checker, mathTeacher, paths.class, ORG.physicsId)).toBe(false);
  });

  it("teacher: class attendance % GRANTED (they read every constituent row)", () => {
    expect(canReadAttendanceAgg(checker, mathTeacher, paths.class)).toBe(true);
    expect(canReadAttendanceAgg(checker, mathTeacher, paths.sectionA)).toBe(true);
    expect(canReadAttendanceAgg(checker, mathTeacher, paths.sectionB)).toBe(true);
  });

  it("teacher: department/college aggregates DENIED (grant does not cover the node)", () => {
    expect(canReadAttendanceAgg(checker, mathTeacher, paths.department)).toBe(false);
    expect(canReadMarksAgg(checker, mathTeacher, paths.department, ORG.mathId)).toBe(false);
    expect(canReadAttendanceAgg(checker, mathTeacher, paths.college)).toBe(false);
  });
});

describe("worked example 2 — the cross-subject wall (the subtle leak, closed)", () => {
  it("teacher: the class OVERALL average is DENIED at the physics constituent", () => {
    const closure = canReadCrossSubjectAgg(checker, mathTeacher, paths.class, BOTH_SUBJECTS);
    expect(closure.granted).toBe(false);
    expect(closure.deniedSubjectId).toBe(ORG.physicsId);
    // Why it matters: overall = f(math, physics); the teacher knows the math
    // component — serving the overall would reveal physics by differencing.
  });

  it("class_teacher/hod/principal/admin: overall GRANTED (they read every constituent)", () => {
    for (const reader of [classTeacher, hod, principal, admin]) {
      expect(canReadCrossSubjectAgg(checker, reader, paths.class, BOTH_SUBJECTS).granted).toBe(true);
    }
  });

  it("hod at department level: overall GRANTED; a college overall for hod: DENIED", () => {
    expect(canReadCrossSubjectAgg(checker, hod, paths.department, BOTH_SUBJECTS).granted).toBe(true);
    expect(canReadCrossSubjectAgg(checker, hod, paths.college, BOTH_SUBJECTS).granted).toBe(false);
  });

  it("an empty constituent list discloses nothing (vacuously granted, nothing to serve)", () => {
    expect(canReadCrossSubjectAgg(checker, mathTeacher, paths.class, []).granted).toBe(true);
  });
});

describe("worked example 3 — the minimum-cohort rule (unconditional, K=5)", () => {
  it("a cohort of 1 is withheld: the 'class average' IS that student's mark", () => {
    expect(cohortSufficient(1, 5)).toBe(false);
  });

  it("withheld for EVERY role — a principal's 3-student section shows the designed state", () => {
    // The rule is caller-independent by design (approved decision):
    // cohortSufficient takes no principal — there is no privileged path
    // around it, so it fails closed for any future consumer.
    expect(cohortSufficient(3, 5)).toBe(false);
    expect(cohortSufficient(4, 5)).toBe(false);
  });

  it("served at and above the floor", () => {
    expect(cohortSufficient(5, 5)).toBe(true);
    expect(cohortSufficient(120, 5)).toBe(true);
  });
});

describe("worked example 4 — aggregates are checked with CONSTITUENT refs", () => {
  it("attendance aggregate refs carry no subjectId; marks aggregate refs always do", async () => {
    const { attendanceAggRef, marksAggRef } = await import("./aggregation-scope");
    const attendance = attendanceAggRef(paths.class);
    expect(attendance).toEqual({
      module: "academics",
      resourceType: "attendance-record",
      org: paths.class,
    });
    expect("subjectId" in attendance).toBe(false);
    expect(marksAggRef(paths.class, ORG.mathId)).toEqual({
      module: "academics",
      resourceType: "marks",
      org: paths.class,
      subjectId: ORG.mathId,
    });
  });
});
