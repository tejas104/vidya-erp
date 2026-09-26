import { and, eq } from "drizzle-orm";
import type { Db, OrgPath } from "@vidya/platform";
import { pplClasses, pplColleges, pplDepartments, pplEnrollments,
  pplProgressionCorrections, pplSections, pplStudents } from "../db/schema";

/** A locked, verified people-owned source for an immutable school document. */
export interface CertificateSource {
  readonly org: OrgPath & { departmentId: string; classId: string; sectionId: string };
  readonly schoolName: string;
  readonly student: { id: string; fullName: string; admissionNo: string };
  readonly enrollment: {
    id: string; academicYear: string; className: string; sectionName: string;
    startsOn: string; endsOn: string | null; status: string;
    outcome: string | null; outcomeReason: string | null; corrected: boolean;
  };
}

/** Called on the issuer's transaction handle. The student and enrollment locks
 * serialize with progression correction and ordinary profile/date changes. */
export async function certificateSourceInTransaction(
  tx: Db, studentId: string, enrollmentId: string,
): Promise<CertificateSource | null> {
  const [student] = await tx.select().from(pplStudents).where(eq(pplStudents.id, studentId)).for("share");
  if (!student) return null;
  const [enrollment] = await tx.select().from(pplEnrollments).where(and(
    eq(pplEnrollments.id, enrollmentId), eq(pplEnrollments.studentId, studentId),
  )).for("share");
  if (!enrollment || enrollment.startsOn === null || enrollment.status === "voided") return null;
  const [section] = await tx.select().from(pplSections).where(eq(pplSections.id, enrollment.sectionId)).for("share");
  if (!section) return null;
  const [klass] = await tx.select().from(pplClasses).where(eq(pplClasses.id, section.classId)).for("share");
  if (!klass) return null;
  const [department] = await tx.select().from(pplDepartments).where(eq(pplDepartments.id, klass.departmentId)).for("share");
  if (!department || department.collegeId !== student.collegeId) return null;
  const [school] = await tx.select().from(pplColleges).where(eq(pplColleges.id, student.collegeId)).for("share");
  if (!school) return null;
  const [correction] = await tx.select({ id: pplProgressionCorrections.id }).from(pplProgressionCorrections)
    .where(eq(pplProgressionCorrections.sourceEnrollmentId, enrollmentId)).limit(1);
  return {
    org: { collegeId: school.id, departmentId: department.id, classId: klass.id, sectionId: section.id },
    schoolName: school.name,
    student: { id: student.id, fullName: student.fullName, admissionNo: student.admissionNo },
    enrollment: {
      id: enrollment.id, academicYear: enrollment.academicYear, className: klass.name,
      sectionName: section.name, startsOn: enrollment.startsOn, endsOn: enrollment.endsOn,
      status: enrollment.status, outcome: enrollment.outcome, outcomeReason: enrollment.outcomeReason,
      corrected: correction !== undefined,
    },
  };
}
