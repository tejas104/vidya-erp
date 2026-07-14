import type { ResourceRef } from "@vidya/platform";

/**
 * THE scope-integration surface of the academics module — deliberately one
 * short file so the security review reads one page (ADR-0017).
 *
 * The distinction these builders encode is load-bearing for the whole
 * permission matrix (ADR-0010):
 *
 *  - ATTENDANCE records are subject-aware since the subject-teacher
 *    revision: a whole-section session (subjectId "" / absent) is a
 *    NON-SUBJECT record only the class teacher writes; a subject teacher's
 *    own period carries that subject's id and becomes a SUBJECT record —
 *    writable by that subject's teacher, correctable by the class teacher.
 *
 *  - MARKS records are SUBJECT records: their ResourceRef always carries
 *    the owning assessment's subjectId — taken from the stored assessment
 *    row, never from caller input. Consequence: cross-subject marks are
 *    unreadable and unwritable for other teachers.
 *
 * Org paths come from the DENORMALIZED columns stamped onto each row at
 * creation (validated against the PeopleDirectory) — records keep their
 * historical position, and scope checks never need cross-module lookups.
 */

/** The stored org position of an attendance session (section-level). */
export interface AttendancePosition {
  readonly collegeId: string;
  readonly departmentId: string;
  readonly classId: string;
  readonly sectionId: string;
  /** "" or absent ⇒ whole-section session; a value ⇒ a subject teacher's period. */
  readonly subjectId?: string;
}

/** The stored org position of an assessment (class-level) + its subject. */
export interface AssessmentPosition {
  readonly collegeId: string;
  readonly departmentId: string;
  readonly classId: string;
  readonly subjectId: string;
}

export function attendanceRef(position: AttendancePosition): ResourceRef {
  // An empty subjectId means "whole-section session" — a non-subject record;
  // it must NOT reach the checker as a subject record, so normalise "" away.
  const subjectId =
    position.subjectId !== undefined && position.subjectId !== "" ? position.subjectId : undefined;
  return {
    module: "academics",
    resourceType: "attendance-record",
    org: {
      collegeId: position.collegeId,
      departmentId: position.departmentId,
      classId: position.classId,
      sectionId: position.sectionId,
    },
    ...(subjectId !== undefined ? { subjectId } : {}),
  };
}

export function marksRef(
  position: AssessmentPosition,
  resourceType: "marks" | "assessment" = "marks",
): ResourceRef {
  return {
    module: "academics",
    resourceType,
    org: {
      collegeId: position.collegeId,
      departmentId: position.departmentId,
      classId: position.classId,
      // Class-level: marks belong to the class+subject, not a section.
    },
    subjectId: position.subjectId,
  };
}
