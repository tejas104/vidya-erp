import { and, asc, count, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { newId } from "../ids";
import {
  pplClasses,
  pplEnrollments,
  pplStudentDocuments,
  pplStudents,
  pplTeacherAssignments,
  pplTeachers,
  type PplAssignmentRow,
  type PplEnrollmentRow,
  type PplStudentDocumentRow,
  type PplStudentRow,
  type PplTeacherRow,
} from "../db/schema";

export interface NewDocument {
  readonly studentId: string;
  readonly collegeId: string;
  readonly departmentId: string;
  readonly classId: string;
  readonly sectionId: string;
  readonly kind: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly objectKey: string;
  readonly uploadedBy: string;
}

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

export class EnrollmentConflictError extends Error {
  constructor() { super("Enrollment changed; reload before transferring this pupil."); this.name = "EnrollmentConflictError"; }
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
    patch: {
      fullName?: string;
      status?: StudentStatus;
      identityUserId?: string | null;
      phone?: string | null;
      guardianName?: string | null;
      guardianPhone?: string | null;
      dob?: string | null;
    },
  ): Promise<PplStudentRow | null>;

  /** Batched existence lookups for the bulk importer. */
  findExistingAdmissionNos(collegeId: string, admissionNos: readonly string[]): Promise<Set<string>>;
  findExistingStaffNos(collegeId: string, staffNos: readonly string[]): Promise<Set<string>>;
  /** Which of these student ids exist (batched; PeopleDirectory, #4). */
  findExistingStudentIds(studentIds: readonly string[]): Promise<Set<string>>;
  /** Active-student headcount, org-wide (license seat usage, #11.75 item 1). */
  countActiveStudents(): Promise<number>;
  /** Sections holding at least one live enrollment (attendance gap scan, #4). */
  sectionsWithLiveEnrollment(): Promise<string[]>;
  createDocument(input: NewDocument): Promise<PplStudentDocumentRow>;
  listDocuments(studentId: string): Promise<PplStudentDocumentRow[]>;
  getDocument(id: string): Promise<PplStudentDocumentRow | null>;
  deleteDocument(id: string): Promise<boolean>;

  createTeacher(input: {
    collegeId: string;
    staffNo: string;
    fullName: string;
    sourceImportId?: string;
  }): Promise<PplTeacherRow>;
  getTeacher(id: string): Promise<PplTeacherRow | null>;
  listTeachers(collegeId: string, options: { q?: string; offset: number; limit: number }): Promise<{ teachers: PplTeacherRow[]; nextOffset: number | null }>;
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
  /** All enrollment rows, including withdrawn records, for the pupil history. */
  listEnrollments(studentId: string): Promise<PplEnrollmentRow[]>;
  withdrawEnrollment(enrollmentId: string, endsOn?: string | null): Promise<void>;
  createEnrollment(input: {
    studentId: string;
    sectionId: string;
    academicYear: string;
    startsOn?: string | null;
  }): Promise<PplEnrollmentRow>;
  replaceEnrollment(previousId: string, input: { studentId: string; sectionId: string; academicYear: string; startsOn?: string | null }, previousEndsOn: string | null): Promise<PplEnrollmentRow>;
  roster(sectionId: string): Promise<{ enrollment: PplEnrollmentRow; student: PplStudentRow }[]>;
  /** Includes withdrawn pupils so a past term can still be reviewed. */
  sectionEnrollmentHistory(sectionId: string, academicYear: string): Promise<PplEnrollmentRow[]>;
  updateEnrollmentDates(enrollmentId: string, startsOn: string, endsOn: string | null, expectedStartsOn: string | null, expectedEndsOn: string | null): Promise<PplEnrollmentRow | null>;

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
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.guardianName !== undefined ? { guardianName: patch.guardianName } : {}),
          ...(patch.guardianPhone !== undefined ? { guardianPhone: patch.guardianPhone } : {}),
          ...(patch.dob !== undefined ? { dob: patch.dob } : {}),
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

    async countActiveStudents() {
      const rows = await db
        .select({ value: count() })
        .from(pplStudents)
        .where(eq(pplStudents.status, "active"));
      return rows[0]?.value ?? 0;
    },

    async sectionsWithLiveEnrollment() {
      const rows = await db
        .selectDistinct({ sectionId: pplEnrollments.sectionId })
        .from(pplEnrollments)
        .where(eq(pplEnrollments.status, "enrolled"));
      return rows.map((row) => row.sectionId);
    },

    async createDocument(input) {
      const rows = await db
        .insert(pplStudentDocuments)
        .values({ id: newId("doc"), ...input })
        .returning();
      return rows[0]!;
    },
    async listDocuments(studentId) {
      return db
        .select()
        .from(pplStudentDocuments)
        .where(eq(pplStudentDocuments.studentId, studentId))
        .orderBy(asc(pplStudentDocuments.createdAt));
    },
    async getDocument(id) {
      const rows = await db.select().from(pplStudentDocuments).where(eq(pplStudentDocuments.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async deleteDocument(id) {
      const rows = await db.delete(pplStudentDocuments).where(eq(pplStudentDocuments.id, id)).returning();
      return rows.length > 0;
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

    async listTeachers(collegeId, options) {
      const search = options.q?.trim();
      const escaped = search?.replace(/[\\%_]/g, "\\$&");
      const rows = await db.select().from(pplTeachers)
        .where(and(
          eq(pplTeachers.collegeId, collegeId),
          escaped ? or(ilike(pplTeachers.fullName, `%${escaped}%`), ilike(pplTeachers.staffNo, `%${escaped}%`)) : undefined,
        ))
        .orderBy(asc(pplTeachers.staffNo), asc(pplTeachers.id))
        .limit(options.limit + 1).offset(options.offset);
      return { teachers: rows.slice(0, options.limit), nextOffset: rows.length > options.limit ? options.offset + options.limit : null };
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
      try {
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
      } catch (error) {
        if (patch.identityUserId !== undefined && pgErrorCode(error) === "23505") {
          throw new DuplicatePersonError("teacher", "identity link");
        }
        throw error;
      }
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

    async listEnrollments(studentId) {
      return db.select().from(pplEnrollments)
        .where(eq(pplEnrollments.studentId, studentId))
        .orderBy(asc(pplEnrollments.createdAt), asc(pplEnrollments.id));
    },

    async withdrawEnrollment(enrollmentId, endsOn) {
      await db
        .update(pplEnrollments)
        .set({ status: "withdrawn", ...(endsOn !== undefined ? { endsOn } : {}), updatedAt: new Date() })
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
          startsOn: input.startsOn ?? null,
        })
        .returning();
      return rows[0]!;
    },

    async replaceEnrollment(previousId, input, previousEndsOn) {
      return db.transaction(async (tx) => {
        const previous = await tx.update(pplEnrollments)
          .set({ status: "withdrawn", endsOn: previousEndsOn, updatedAt: new Date() })
          .where(and(eq(pplEnrollments.id, previousId), eq(pplEnrollments.studentId, input.studentId), eq(pplEnrollments.academicYear, input.academicYear), eq(pplEnrollments.status, "enrolled")))
          .returning();
        if (!previous.length) throw new EnrollmentConflictError();
        const inserted = await tx.insert(pplEnrollments).values({
          id: newId("enr"), studentId: input.studentId, sectionId: input.sectionId,
          academicYear: input.academicYear, startsOn: input.startsOn ?? null,
        }).returning();
        return inserted[0]!;
      });
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

    async sectionEnrollmentHistory(sectionId, academicYear) {
      return db.select().from(pplEnrollments)
        .where(and(eq(pplEnrollments.sectionId, sectionId), eq(pplEnrollments.academicYear, academicYear)))
        .orderBy(asc(pplEnrollments.studentId), asc(pplEnrollments.createdAt));
    },

    async updateEnrollmentDates(enrollmentId, startsOn, endsOn, expectedStartsOn, expectedEndsOn) {
      const rows = await db.update(pplEnrollments)
        .set({ startsOn, endsOn, updatedAt: new Date() })
        .where(and(eq(pplEnrollments.id, enrollmentId), expectedStartsOn === null ? isNull(pplEnrollments.startsOn) : eq(pplEnrollments.startsOn, expectedStartsOn), expectedEndsOn === null ? isNull(pplEnrollments.endsOn) : eq(pplEnrollments.endsOn, expectedEndsOn))).returning();
      return rows[0] ?? null;
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
