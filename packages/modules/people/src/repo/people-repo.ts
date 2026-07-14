import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { newId } from "../ids";
import {
  pplClasses,
  pplEnrollments,
  pplStudents,
  pplTeacherAssignments,
  pplTeachers,
  type PplAssignmentRow,
  type PplEnrollmentRow,
  type PplStudentRow,
  type PplTeacherRow,
} from "../db/schema";

export type AssignmentKind = "subject_teacher" | "class_teacher";
export type PersonStatus = "active" | "inactive";
/** Students move through a full lifecycle; the record is never destroyed. */
export type StudentStatus =
  | "active"
  | "inactive"
  | "backlog"
  | "year_back"
  | "transferred"
  | "dropped"
  | "alumni";

export class DuplicatePersonError extends Error {
  constructor(kind: "student" | "teacher", number: string) {
    super(`${kind} with number "${number}" already exists in this college`);
    this.name = "DuplicatePersonError";
  }
}

export class DuplicateAssignmentError extends Error {
  constructor() {
    super("an equivalent assignment already exists for this class/subject/year");
    this.name = "DuplicateAssignmentError";
  }
}

function pgErrorCode(error: unknown): string | undefined {
  // drizzle >=0.44 wraps driver errors in DrizzleQueryError; the pg code rides on .cause
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}

export interface PeopleRepo {
  createStudent(input: {
    collegeId: string;
    admissionNo: string;
    fullName: string;
    sourceImportId?: string;
  }): Promise<PplStudentRow>;
  getStudent(id: string): Promise<PplStudentRow | null>;
  findStudentByAdmissionNo(collegeId: string, admissionNo: string): Promise<PplStudentRow | null>;
  /** The student linked to an identity sign-in (W1 portal), if any. */
  findStudentByIdentityUser(identityUserId: string): Promise<PplStudentRow | null>;
  updateStudent(
    id: string,
    patch: { fullName?: string; status?: StudentStatus; identityUserId?: string | null },
  ): Promise<PplStudentRow | null>;

  /** Batched existence lookups for the bulk importer. */
  findExistingAdmissionNos(collegeId: string, admissionNos: readonly string[]): Promise<Set<string>>;
  findExistingStaffNos(collegeId: string, staffNos: readonly string[]): Promise<Set<string>>;
  /** Which of these student ids exist (batched; PeopleDirectory, #4). */
  findExistingStudentIds(studentIds: readonly string[]): Promise<Set<string>>;
  /** Sections holding at least one live enrollment (attendance gap scan, #4). */
  sectionsWithLiveEnrollment(): Promise<string[]>;

  createTeacher(input: {
    collegeId: string;
    staffNo: string;
    fullName: string;
    sourceImportId?: string;
  }): Promise<PplTeacherRow>;
  getTeacher(id: string): Promise<PplTeacherRow | null>;
  findTeacherByStaffNo(collegeId: string, staffNo: string): Promise<PplTeacherRow | null>;
  /** The teacher linked to an identity sign-in (timetable self-scope), if any. */
  findTeacherByIdentityUser(identityUserId: string): Promise<PplTeacherRow | null>;
  updateTeacher(
    id: string,
    patch: { fullName?: string; status?: PersonStatus; identityUserId?: string | null },
  ): Promise<PplTeacherRow | null>;

  /** The student's live enrollment for a year (at most one, by partial unique). */
  activeEnrollment(studentId: string, academicYear: string): Promise<PplEnrollmentRow | null>;
  latestActiveEnrollment(studentId: string): Promise<PplEnrollmentRow | null>;
  withdrawEnrollment(enrollmentId: string): Promise<void>;
  createEnrollment(input: {
    studentId: string;
    sectionId: string;
    academicYear: string;
  }): Promise<PplEnrollmentRow>;
  roster(sectionId: string): Promise<{ enrollment: PplEnrollmentRow; student: PplStudentRow }[]>;

  createAssignment(input: {
    teacherId: string;
    classId: string;
    subjectId?: string;
    kind: AssignmentKind;
    academicYear: string;
  }): Promise<PplAssignmentRow>;
  getAssignment(id: string): Promise<PplAssignmentRow | null>;
  deleteAssignment(id: string): Promise<boolean>;
  assignmentsByClass(classId: string): Promise<PplAssignmentRow[]>;
  assignmentsByTeacher(teacherId: string): Promise<PplAssignmentRow[]>;
  listAllAssignments(): Promise<PplAssignmentRow[]>;
  /** Distinct department ids across a teacher's assignments (via their classes). */
  departmentsForTeacher(teacherId: string): Promise<string[]>;
}

export function createPeopleRepo(db: Db): PeopleRepo {
  return {
    async createStudent(input) {
      try {
        const rows = await db
          .insert(pplStudents)
          .values({
            id: newId("stu"),
            collegeId: input.collegeId,
            admissionNo: input.admissionNo,
            fullName: input.fullName,
            sourceImportId: input.sourceImportId ?? null,
          })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new DuplicatePersonError("student", input.admissionNo);
        }
        throw error;
      }
    },

    async getStudent(id) {
      const rows = await db.select().from(pplStudents).where(eq(pplStudents.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findStudentByAdmissionNo(collegeId, admissionNo) {
      const rows = await db
        .select()
        .from(pplStudents)
        .where(and(eq(pplStudents.collegeId, collegeId), eq(pplStudents.admissionNo, admissionNo)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findStudentByIdentityUser(identityUserId) {
      const rows = await db
        .select()
        .from(pplStudents)
        .where(eq(pplStudents.identityUserId, identityUserId))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateStudent(id, patch) {
      const rows = await db
        .update(pplStudents)
        .set({
          ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.identityUserId !== undefined ? { identityUserId: patch.identityUserId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(pplStudents.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async findExistingAdmissionNos(collegeId, admissionNos) {
      const existing = new Set<string>();
      for (let index = 0; index < admissionNos.length; index += 1000) {
        const chunk = admissionNos.slice(index, index + 1000);
        const rows = await db
          .select({ admissionNo: pplStudents.admissionNo })
          .from(pplStudents)
          .where(and(eq(pplStudents.collegeId, collegeId), inArray(pplStudents.admissionNo, chunk)));
        for (const row of rows) {
          existing.add(row.admissionNo);
        }
      }
      return existing;
    },

    async findExistingStaffNos(collegeId, staffNos) {
      const existing = new Set<string>();
      for (let index = 0; index < staffNos.length; index += 1000) {
        const chunk = staffNos.slice(index, index + 1000);
        const rows = await db
          .select({ staffNo: pplTeachers.staffNo })
          .from(pplTeachers)
          .where(and(eq(pplTeachers.collegeId, collegeId), inArray(pplTeachers.staffNo, chunk)));
        for (const row of rows) {
          existing.add(row.staffNo);
        }
      }
      return existing;
    },

    async findExistingStudentIds(studentIds) {
      const existing = new Set<string>();
      for (let index = 0; index < studentIds.length; index += 1000) {
        const chunk = studentIds.slice(index, index + 1000);
        const rows = await db
          .select({ id: pplStudents.id })
          .from(pplStudents)
          .where(inArray(pplStudents.id, chunk));
        for (const row of rows) {
          existing.add(row.id);
        }
      }
      return existing;
    },

    async sectionsWithLiveEnrollment() {
      const rows = await db
        .selectDistinct({ sectionId: pplEnrollments.sectionId })
        .from(pplEnrollments)
        .where(eq(pplEnrollments.status, "enrolled"));
      return rows.map((row) => row.sectionId);
    },

    async createTeacher(input) {
      try {
        const rows = await db
          .insert(pplTeachers)
          .values({
            id: newId("tch"),
            collegeId: input.collegeId,
            staffNo: input.staffNo,
            fullName: input.fullName,
            sourceImportId: input.sourceImportId ?? null,
          })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new DuplicatePersonError("teacher", input.staffNo);
        }
        throw error;
      }
    },

    async getTeacher(id) {
      const rows = await db.select().from(pplTeachers).where(eq(pplTeachers.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findTeacherByStaffNo(collegeId, staffNo) {
      const rows = await db
        .select()
        .from(pplTeachers)
        .where(and(eq(pplTeachers.collegeId, collegeId), eq(pplTeachers.staffNo, staffNo)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findTeacherByIdentityUser(identityUserId) {
      const rows = await db
        .select()
        .from(pplTeachers)
        .where(eq(pplTeachers.identityUserId, identityUserId))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateTeacher(id, patch) {
      const rows = await db
        .update(pplTeachers)
        .set({
          ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.identityUserId !== undefined ? { identityUserId: patch.identityUserId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(pplTeachers.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async activeEnrollment(studentId, academicYear) {
      const rows = await db
        .select()
        .from(pplEnrollments)
        .where(
          and(
            eq(pplEnrollments.studentId, studentId),
            eq(pplEnrollments.academicYear, academicYear),
            eq(pplEnrollments.status, "enrolled"),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async latestActiveEnrollment(studentId) {
      const rows = await db
        .select()
        .from(pplEnrollments)
        .where(and(eq(pplEnrollments.studentId, studentId), eq(pplEnrollments.status, "enrolled")))
        .orderBy(asc(pplEnrollments.academicYear));
      return rows[rows.length - 1] ?? null;
    },

    async withdrawEnrollment(enrollmentId) {
      await db
        .update(pplEnrollments)
        .set({ status: "withdrawn", updatedAt: new Date() })
        .where(eq(pplEnrollments.id, enrollmentId));
    },

    async createEnrollment(input) {
      const rows = await db
        .insert(pplEnrollments)
        .values({
          id: newId("enr"),
          studentId: input.studentId,
          sectionId: input.sectionId,
          academicYear: input.academicYear,
        })
        .returning();
      return rows[0]!;
    },

    async roster(sectionId) {
      const rows = await db
        .select({ enrollment: pplEnrollments, student: pplStudents })
        .from(pplEnrollments)
        .innerJoin(pplStudents, eq(pplEnrollments.studentId, pplStudents.id))
        .where(and(eq(pplEnrollments.sectionId, sectionId), eq(pplEnrollments.status, "enrolled")))
        .orderBy(asc(pplStudents.fullName));
      return rows;
    },

    async createAssignment(input) {
      try {
        const rows = await db
          .insert(pplTeacherAssignments)
          .values({
            id: newId("asg"),
            teacherId: input.teacherId,
            classId: input.classId,
            subjectId: input.subjectId ?? null,
            kind: input.kind,
            academicYear: input.academicYear,
          })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new DuplicateAssignmentError();
        }
        throw error;
      }
    },

    async getAssignment(id) {
      const rows = await db
        .select()
        .from(pplTeacherAssignments)
        .where(eq(pplTeacherAssignments.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async deleteAssignment(id) {
      const rows = await db
        .delete(pplTeacherAssignments)
        .where(eq(pplTeacherAssignments.id, id))
        .returning({ id: pplTeacherAssignments.id });
      return rows.length > 0;
    },

    async assignmentsByClass(classId) {
      return db
        .select()
        .from(pplTeacherAssignments)
        .where(eq(pplTeacherAssignments.classId, classId))
        .orderBy(asc(pplTeacherAssignments.createdAt));
    },

    async assignmentsByTeacher(teacherId) {
      return db
        .select()
        .from(pplTeacherAssignments)
        .where(eq(pplTeacherAssignments.teacherId, teacherId))
        .orderBy(asc(pplTeacherAssignments.createdAt));
    },

    async listAllAssignments() {
      return db.select().from(pplTeacherAssignments).orderBy(asc(pplTeacherAssignments.createdAt));
    },

    async departmentsForTeacher(teacherId) {
      const rows = await db
        .selectDistinct({ departmentId: pplClasses.departmentId })
        .from(pplTeacherAssignments)
        .innerJoin(pplClasses, eq(pplTeacherAssignments.classId, pplClasses.id))
        .where(eq(pplTeacherAssignments.teacherId, teacherId));
      return rows.map((row) => row.departmentId);
    },
  };
}
