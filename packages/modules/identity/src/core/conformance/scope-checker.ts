import { describe, expect, it } from "vitest";
import type {
  AccessAction,
  OrgPath,
  Principal,
  ResourceRef,
  ScopeChecker,
  ScopeGrant,
} from "@vidya/platform";

/**
 * CONFORMANCE SUITE — ScopeChecker (Fable-authored acceptance harness for
 * the HUMAN-OWNED scope-check function). This file IS the approved
 * permission matrix (ADR-0010) in executable form:
 *
 *   teacher        read: non-subject records (whole-section attendance,
 *                  conduct, ...) in their attached class/section, plus their
 *                  OWN subject's records (marks + their own attendance
 *                  period); other subjects' records are private to their
 *                  teachers (human-directed revision, 2026-07-04)
 *                  write: their own class + subject only (create/update/delete),
 *                  which now includes marking their own attendance period
 *   class_teacher  read: their class(es), all sections/subjects
 *                  write: their class's non-subject records AND attendance of
 *                  any subject (period correction authority); never subject marks
 *   hod            read: their entire department
 *                  write: department-level approvals ("approve") only
 *   principal      read: college-wide · write: none (pure viewer)
 *   admin          read: college-wide (support) · write: identity records only
 *   self-access    anyone reads their own profile (ownerUserId)
 *   deny-by-default: no match → denied
 *
 * Spec decisions encoded here and flagged in docs/review-gate-2.md for
 * human confirmation: "export" follows read scope but only for hod,
 * principal and admin (bulk-exfiltration control); "approve" is denied to
 * teacher and class_teacher.
 */

const grant = (g: {
  role: ScopeGrant["role"];
  org: OrgPath;
  subjectId?: string;
}): ScopeGrant => ({
  role: g.role,
  org: g.org,
  ...(g.subjectId !== undefined ? { subjectId: g.subjectId } : {}),
});

function caller(id: string, roles: Principal["roles"], grants: ScopeGrant[]): Principal {
  return { id, kind: "user", displayName: id, roles, scopes: [], grants, sessionId: "s" };
}

const COL = "col-1";
const OTHER_COL = "col-2";
const DEP = "dep-science";
const OTHER_DEP = "dep-arts";
const CLS = "cls-10a";
const OTHER_CLS = "cls-10b";
const SEC = "sec-10a-1";
const OTHER_SEC = "sec-10a-2";
const SUB = "sub-math";
const OTHER_SUB = "sub-physics";

const inClass = (extra: Partial<ResourceRef> = {}): ResourceRef => ({
  module: "academics",
  resourceType: "marks",
  org: { collegeId: COL, departmentId: DEP, classId: CLS },
  subjectId: SUB,
  ...extra,
});

const attendance = (org: OrgPath): ResourceRef => ({
  module: "academics",
  resourceType: "attendance-record",
  org,
});

// A subject teacher's own attendance period — a SUBJECT record scoped to
// its subject (subject-teacher attendance revision, 2026-07-14).
const subjectAttendance = (
  subjectId: string,
  org: OrgPath = { collegeId: COL, departmentId: DEP, classId: CLS, sectionId: SEC },
): ResourceRef => ({ module: "academics", resourceType: "attendance-record", org, subjectId });

// --- The callers -----------------------------------------------------------

const teacherClassLevel = caller("t-1", ["teacher"], [
  grant({ role: "teacher", org: { collegeId: COL, departmentId: DEP, classId: CLS }, subjectId: SUB }),
]);
const teacherSectionLevel = caller("t-2", ["teacher"], [
  grant({
    role: "teacher",
    org: { collegeId: COL, departmentId: DEP, classId: CLS, sectionId: SEC },
    subjectId: SUB,
  }),
]);
const classTeacher = caller("ct-1", ["class_teacher"], [
  grant({ role: "class_teacher", org: { collegeId: COL, departmentId: DEP, classId: CLS } }),
]);
const hod = caller("h-1", ["hod"], [
  grant({ role: "hod", org: { collegeId: COL, departmentId: DEP } }),
]);
const principal = caller("p-1", ["principal"], [
  grant({ role: "principal", org: { collegeId: COL } }),
]);
const admin = caller("a-1", ["admin"], [grant({ role: "admin", org: { collegeId: COL } })]);
const noGrants = caller("n-1", ["teacher"], []);

interface Case {
  readonly name: string;
  readonly caller: Principal;
  readonly action: AccessAction;
  readonly resource: ResourceRef;
  readonly expect: boolean;
}

const MATRIX: readonly Case[] = [
  // --- teacher: read any subject within the attached class -----------------
  { name: "teacher reads own-subject marks in own class", caller: teacherClassLevel, action: "read", resource: inClass(), expect: true },
  { name: "teacher cannot read OTHER-subject marks (privacy line between teachers)", caller: teacherClassLevel, action: "read", resource: inClass({ subjectId: OTHER_SUB }), expect: false },
  { name: "teacher reads non-subject records in own class", caller: teacherClassLevel, action: "read", resource: attendance({ collegeId: COL, departmentId: DEP, classId: CLS }), expect: true },
  { name: "teacher class-level grant covers the class's sections", caller: teacherClassLevel, action: "read", resource: attendance({ collegeId: COL, departmentId: DEP, classId: CLS, sectionId: SEC }), expect: true },
  { name: "teacher cannot read another class", caller: teacherClassLevel, action: "read", resource: inClass({ org: { collegeId: COL, departmentId: DEP, classId: OTHER_CLS } }), expect: false },
  { name: "teacher cannot read another college", caller: teacherClassLevel, action: "read", resource: inClass({ org: { collegeId: OTHER_COL, departmentId: DEP, classId: CLS } }), expect: false },
  // --- teacher: write own class + subject only -----------------------------
  { name: "teacher creates marks for own class+subject", caller: teacherClassLevel, action: "create", resource: inClass(), expect: true },
  { name: "teacher updates marks for own class+subject", caller: teacherClassLevel, action: "update", resource: inClass(), expect: true },
  { name: "teacher deletes marks for own class+subject", caller: teacherClassLevel, action: "delete", resource: inClass(), expect: true },
  { name: "teacher cannot write another teacher's subject", caller: teacherClassLevel, action: "update", resource: inClass({ subjectId: OTHER_SUB }), expect: false },
  { name: "teacher cannot write whole-section (non-subject) attendance", caller: teacherClassLevel, action: "update", resource: attendance({ collegeId: COL, departmentId: DEP, classId: CLS }), expect: false },
  // --- subject-teacher attendance: a teacher owns their own period --------
  { name: "subject teacher marks their OWN subject's attendance period", caller: teacherClassLevel, action: "create", resource: subjectAttendance(SUB), expect: true },
  { name: "subject teacher corrects their own subject's attendance", caller: teacherClassLevel, action: "update", resource: subjectAttendance(SUB), expect: true },
  { name: "subject teacher cannot mark another subject's attendance", caller: teacherClassLevel, action: "create", resource: subjectAttendance(OTHER_SUB), expect: false },
  { name: "subject teacher reads their own subject's attendance", caller: teacherClassLevel, action: "read", resource: subjectAttendance(SUB), expect: true },
  { name: "subject teacher cannot read another subject's attendance (privacy line)", caller: teacherClassLevel, action: "read", resource: subjectAttendance(OTHER_SUB), expect: false },
  { name: "teacher cannot write own subject in another class", caller: teacherClassLevel, action: "update", resource: inClass({ org: { collegeId: COL, departmentId: DEP, classId: OTHER_CLS } }), expect: false },
  { name: "teacher cannot approve (department-level act)", caller: teacherClassLevel, action: "approve", resource: inClass(), expect: false },
  { name: "teacher cannot export", caller: teacherClassLevel, action: "export", resource: inClass(), expect: false },
  // --- teacher at section granularity ---------------------------------------
  { name: "section-scoped teacher reads own section", caller: teacherSectionLevel, action: "read", resource: inClass({ org: { collegeId: COL, departmentId: DEP, classId: CLS, sectionId: SEC } }), expect: true },
  { name: "section-scoped teacher cannot read the sibling section", caller: teacherSectionLevel, action: "read", resource: inClass({ org: { collegeId: COL, departmentId: DEP, classId: CLS, sectionId: OTHER_SEC } }), expect: false },
  { name: "section-scoped teacher cannot read the whole class (broader than grant)", caller: teacherSectionLevel, action: "read", resource: inClass({ org: { collegeId: COL, departmentId: DEP, classId: CLS } }), expect: false },
  { name: "section-scoped teacher writes own section+subject", caller: teacherSectionLevel, action: "update", resource: inClass({ org: { collegeId: COL, departmentId: DEP, classId: CLS, sectionId: SEC } }), expect: true },
  // --- class_teacher --------------------------------------------------------
  { name: "class_teacher reads subject marks in their class", caller: classTeacher, action: "read", resource: inClass(), expect: true },
  { name: "class_teacher reads any section of their class", caller: classTeacher, action: "read", resource: attendance({ collegeId: COL, departmentId: DEP, classId: CLS, sectionId: OTHER_SEC }), expect: true },
  { name: "class_teacher cannot read another class", caller: classTeacher, action: "read", resource: inClass({ org: { collegeId: COL, departmentId: DEP, classId: OTHER_CLS } }), expect: false },
  { name: "class_teacher writes non-subject records of their class", caller: classTeacher, action: "update", resource: attendance({ collegeId: COL, departmentId: DEP, classId: CLS }), expect: true },
  { name: "class_teacher corrects ANY subject's attendance in their class (correction authority)", caller: classTeacher, action: "update", resource: subjectAttendance(OTHER_SUB), expect: true },
  { name: "class_teacher can record a subject's attendance too", caller: classTeacher, action: "create", resource: subjectAttendance(SUB), expect: true },
  { name: "class_teacher creates non-subject records (e.g. promotion) of their class", caller: classTeacher, action: "create", resource: { module: "academics", resourceType: "promotion", org: { collegeId: COL, departmentId: DEP, classId: CLS } }, expect: true },
  { name: "class_teacher cannot write subject marks", caller: classTeacher, action: "update", resource: inClass(), expect: false },
  { name: "class_teacher cannot write outside their class", caller: classTeacher, action: "update", resource: attendance({ collegeId: COL, departmentId: DEP, classId: OTHER_CLS }), expect: false },
  { name: "class_teacher cannot approve", caller: classTeacher, action: "approve", resource: attendance({ collegeId: COL, departmentId: DEP, classId: CLS }), expect: false },
  { name: "class_teacher cannot export", caller: classTeacher, action: "export", resource: attendance({ collegeId: COL, departmentId: DEP, classId: CLS }), expect: false },
  // --- hod -------------------------------------------------------------------
  { name: "hod reads anything in their department", caller: hod, action: "read", resource: inClass(), expect: true },
  { name: "hod reads section-level records in their department", caller: hod, action: "read", resource: attendance({ collegeId: COL, departmentId: DEP, classId: CLS, sectionId: SEC }), expect: true },
  { name: "hod cannot read another department", caller: hod, action: "read", resource: inClass({ org: { collegeId: COL, departmentId: OTHER_DEP, classId: CLS } }), expect: false },
  { name: "hod approves within their department", caller: hod, action: "approve", resource: inClass(), expect: true },
  { name: "hod cannot do routine subject-record entry", caller: hod, action: "update", resource: inClass(), expect: false },
  { name: "hod cannot create records", caller: hod, action: "create", resource: inClass(), expect: false },
  { name: "hod cannot delete records", caller: hod, action: "delete", resource: inClass(), expect: false },
  { name: "hod cannot approve outside their department", caller: hod, action: "approve", resource: inClass({ org: { collegeId: COL, departmentId: OTHER_DEP, classId: CLS } }), expect: false },
  { name: "hod exports within their department", caller: hod, action: "export", resource: inClass(), expect: true },
  { name: "hod cannot export another department", caller: hod, action: "export", resource: inClass({ org: { collegeId: COL, departmentId: OTHER_DEP } }), expect: false },
  // --- principal --------------------------------------------------------------
  { name: "principal reads college-wide", caller: principal, action: "read", resource: inClass(), expect: true },
  { name: "principal reads any department", caller: principal, action: "read", resource: inClass({ org: { collegeId: COL, departmentId: OTHER_DEP, classId: OTHER_CLS } }), expect: true },
  { name: "principal cannot read another college", caller: principal, action: "read", resource: inClass({ org: { collegeId: OTHER_COL, departmentId: DEP, classId: CLS } }), expect: false },
  { name: "principal cannot update (pure viewer)", caller: principal, action: "update", resource: inClass(), expect: false },
  { name: "principal cannot create", caller: principal, action: "create", resource: inClass(), expect: false },
  { name: "principal cannot approve", caller: principal, action: "approve", resource: inClass(), expect: false },
  { name: "principal cannot write identity records", caller: principal, action: "update", resource: { module: "identity", resourceType: "user", org: { collegeId: COL } }, expect: false },
  { name: "principal exports college-wide", caller: principal, action: "export", resource: inClass(), expect: true },
  // --- admin -------------------------------------------------------------------
  { name: "admin reads academic data for support", caller: admin, action: "read", resource: inClass(), expect: true },
  { name: "admin cannot write academic records", caller: admin, action: "update", resource: inClass(), expect: false },
  { name: "admin cannot approve academic records", caller: admin, action: "approve", resource: inClass(), expect: false },
  { name: "admin creates identity records (users)", caller: admin, action: "create", resource: { module: "identity", resourceType: "user", org: { collegeId: COL } }, expect: true },
  { name: "admin updates identity records (roles)", caller: admin, action: "update", resource: { module: "identity", resourceType: "user-roles", org: { collegeId: COL } }, expect: true },
  { name: "admin deletes identity records (grants)", caller: admin, action: "delete", resource: { module: "identity", resourceType: "scope-grant", org: { collegeId: COL } }, expect: true },
  { name: "admin reads the user directory", caller: admin, action: "read", resource: { module: "identity", resourceType: "user-directory", org: { collegeId: COL } }, expect: true },
  { name: "admin cannot manage identity in another college", caller: admin, action: "create", resource: { module: "identity", resourceType: "user", org: { collegeId: OTHER_COL } }, expect: false },
  // --- ADR-0013: people-module administration (owner-authorized extension, Vidya #3)
  { name: "admin creates org units (people module) in their college", caller: admin, action: "create", resource: { module: "people", resourceType: "department", org: { collegeId: COL } }, expect: true },
  { name: "admin updates people records (student) in their college", caller: admin, action: "update", resource: { module: "people", resourceType: "student", org: { collegeId: COL, departmentId: DEP, classId: CLS } }, expect: true },
  { name: "admin deletes people records (enrollment) in their college", caller: admin, action: "delete", resource: { module: "people", resourceType: "enrollment", org: { collegeId: COL, departmentId: DEP, classId: CLS, sectionId: SEC } }, expect: true },
  { name: "admin cannot manage people records in another college", caller: admin, action: "create", resource: { module: "people", resourceType: "student", org: { collegeId: OTHER_COL } }, expect: false },
  { name: "admin cannot approve people records (approve stays hod-only)", caller: admin, action: "approve", resource: { module: "people", resourceType: "enrollment", org: { collegeId: COL } }, expect: false },
  { name: "teacher cannot write people records (rosters are read-only for teachers)", caller: teacherClassLevel, action: "update", resource: { module: "people", resourceType: "student", org: { collegeId: COL, departmentId: DEP, classId: CLS } }, expect: false },
  { name: "teacher reads their class roster (people module, non-subject)", caller: teacherClassLevel, action: "read", resource: { module: "people", resourceType: "roster", org: { collegeId: COL, departmentId: DEP, classId: CLS } }, expect: true },
  // The matrix's "promotion" clause: class_teacher writes non-subject
  // records OF THEIR CLASS — which includes enrollment moves. Records
  // anchored above their class (e.g. creating a student, which sits at
  // college level until enrolled) stay out of reach via containment.
  { name: "class_teacher writes enrollment records of their class (promotion authority)", caller: classTeacher, action: "create", resource: { module: "people", resourceType: "enrollment", org: { collegeId: COL, departmentId: DEP, classId: CLS } }, expect: true },
  { name: "class_teacher cannot create college-anchored people records (students)", caller: classTeacher, action: "create", resource: { module: "people", resourceType: "student", org: { collegeId: COL } }, expect: false },
  // --- scoped sub-admin (2.4): class teacher edits/adds students IN THEIR SECTION only ---
  { name: "class_teacher updates a student in their class (edit / change-status)", caller: classTeacher, action: "update", resource: { module: "people", resourceType: "student", org: { collegeId: COL, departmentId: DEP, classId: CLS, sectionId: SEC } }, expect: true },
  { name: "class_teacher adds a student INTO their section (section-anchored create)", caller: classTeacher, action: "create", resource: { module: "people", resourceType: "student", org: { collegeId: COL, departmentId: DEP, classId: CLS, sectionId: SEC } }, expect: true },
  { name: "class_teacher cannot write a student in ANOTHER class (403 fail-closed)", caller: classTeacher, action: "update", resource: { module: "people", resourceType: "student", org: { collegeId: COL, departmentId: DEP, classId: OTHER_CLS, sectionId: OTHER_SEC } }, expect: false },
  { name: "class_teacher cannot write enrollment in another class", caller: classTeacher, action: "create", resource: { module: "people", resourceType: "enrollment", org: { collegeId: COL, departmentId: DEP, classId: OTHER_CLS } }, expect: false },
  { name: "hod reads people records across their department", caller: hod, action: "read", resource: { module: "people", resourceType: "teacher-assignment", org: { collegeId: COL, departmentId: DEP, classId: OTHER_CLS } }, expect: true },
  { name: "hod cannot write people records", caller: hod, action: "update", resource: { module: "people", resourceType: "class", org: { collegeId: COL, departmentId: DEP, classId: CLS } }, expect: false },
  { name: "principal reads people records college-wide but writes nothing", caller: principal, action: "read", resource: { module: "people", resourceType: "student", org: { collegeId: COL, departmentId: OTHER_DEP } }, expect: true },
  { name: "principal cannot write people records", caller: principal, action: "create", resource: { module: "people", resourceType: "college", org: { collegeId: COL } }, expect: false },
  { name: "admin exports within the college", caller: admin, action: "export", resource: inClass(), expect: true },
  // --- self-access ---------------------------------------------------------------
  { name: "a user with zero grants reads their own profile", caller: noGrants, action: "read", resource: { module: "identity", resourceType: "user-profile", org: { collegeId: COL }, ownerUserId: "n-1" }, expect: true },
  { name: "self-access does not allow writes", caller: noGrants, action: "update", resource: { module: "identity", resourceType: "user-profile", org: { collegeId: COL }, ownerUserId: "n-1" }, expect: false },
  { name: "no self-access to someone else's profile", caller: noGrants, action: "read", resource: { module: "identity", resourceType: "user-profile", org: { collegeId: COL }, ownerUserId: "someone-else" }, expect: false },
  // --- deny-by-default -------------------------------------------------------------
  { name: "no grants → no academic access at all", caller: noGrants, action: "read", resource: inClass(), expect: false },
  { name: "role membership without a grant conveys nothing", caller: caller("r-1", ["hod"], []), action: "read", resource: inClass(), expect: false },
];

export function describeScopeCheckerConformance(name: string, create: () => ScopeChecker): void {
  describe(`ScopeChecker conformance: ${name} (the ADR-0010 matrix)`, () => {
    for (const testCase of MATRIX) {
      it(`${testCase.expect ? "GRANTS" : "DENIES"}: ${testCase.name}`, () => {
        const checker = create();
        const decision = checker.check(testCase.caller, testCase.action, testCase.resource);
        expect(decision.granted).toBe(testCase.expect);
        if (!decision.granted) {
          expect(decision.reason.length).toBeGreaterThan(0);
        }
      });
    }

    it("is deterministic — identical inputs yield identical decisions", () => {
      const checker = create();
      const first = checker.check(teacherClassLevel, "read", inClass());
      const second = checker.check(teacherClassLevel, "read", inClass());
      expect(second).toEqual(first);
    });

    it("reports the matching grant on grant-based allows", () => {
      const checker = create();
      const decision = checker.check(teacherClassLevel, "read", inClass());
      expect(decision.granted).toBe(true);
      expect(decision.matchedGrant).toEqual(teacherClassLevel.grants[0]);
    });
  });
}

/** Exported so documentation tooling and reviewers can count/inspect cases. */
export const SCOPE_MATRIX_CASES: readonly Case[] = MATRIX;
