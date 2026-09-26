import type { OrgPath } from "@vidya/platform";
import type { OrgRepo } from "../repo/org-repo";
import { EnrollmentConflictError, type PeopleRepo, type PersonStatus, type StudentStatus } from "../repo/people-repo";
import type { PplEnrollmentRow, PplStudentRow, PplTeacherRow } from "../db/schema";

export class UnknownReferenceError extends Error {
  constructor(what: string) {
    super(`unknown reference: ${what}`);
    this.name = "UnknownReferenceError";
  }
}

export class InvalidEnrollmentDatesError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidEnrollmentDatesError"; }
}

export interface PeopleServiceDeps {
  readonly repo: PeopleRepo;
  readonly orgRepo: OrgRepo;
}

/**
 * Students, teachers and enrollment. Handlers add the scope-check; the
 * org POSITION helpers here are what makes that possible — a record's
 * ResourceRef org path is derived from its live enrollment (students) or
 * its college (teachers, unenrolled students).
 */
export class PeopleService {
  constructor(private readonly deps: PeopleServiceDeps) {}

  async createStudent(input: {
    collegeId: string;
    admissionNo: string;
    fullName: string;
  }): Promise<PplStudentRow> {
    if ((await this.deps.orgRepo.getCollege(input.collegeId)) === null) {
      throw new UnknownReferenceError(`collegeId "${input.collegeId}"`);
    }
    return this.deps.repo.createStudent(input);
  }

  getStudent(id: string): Promise<PplStudentRow | null> {
    return this.deps.repo.getStudent(id);
  }

  updateStudent(
    id: string,
    patch: {
      fullName?: string;
      status?: StudentStatus;
      phone?: string | null;
      guardianName?: string | null;
      guardianPhone?: string | null;
      dob?: string | null;
    },
  ): Promise<PplStudentRow | null> {
    return this.deps.repo.updateStudent(id, patch);
  }

  /** W1 portal: link/unlink a student to an identity sign-in (mirrors teachers). */
  linkStudentIdentity(id: string, identityUserId: string | null): Promise<PplStudentRow | null> {
    return this.deps.repo.updateStudent(id, { identityUserId });
  }

  // --- student documents (2.5) ---
  createDocument(input: Parameters<PeopleRepo["createDocument"]>[0]) {
    return this.deps.repo.createDocument(input);
  }
  listDocuments(studentId: string) {
    return this.deps.repo.listDocuments(studentId);
  }
  getDocument(id: string) {
    return this.deps.repo.getDocument(id);
  }
  deleteDocument(id: string) {
    return this.deps.repo.deleteDocument(id);
  }

  getStudentByIdentityUser(identityUserId: string): Promise<PplStudentRow | null> {
    return this.deps.repo.findStudentByIdentityUser(identityUserId);
  }

  /** The student's org position: live enrollment's section path, else college. */
  async studentOrgPosition(student: PplStudentRow): Promise<OrgPath> {
    const enrollment = await this.deps.repo.latestActiveEnrollment(student.id);
    if (enrollment !== null) {
      const path = await this.deps.orgRepo.pathForSection(enrollment.sectionId);
      if (path !== null) {
        return path;
      }
    }
    return { collegeId: student.collegeId };
  }

  /**
   * Enroll or transfer: withdraws the year's live enrollment (if any) and
   * creates the new one. Returns both so the handler can audit the move
   * and scope-check source AND target.
   */
  async enroll(input: {
    studentId: string;
    sectionId: string;
    academicYear: string;
    startsOn?: string | null;
  }): Promise<{ enrollment: PplEnrollmentRow; previous: PplEnrollmentRow | null } | null> {
    const student = await this.deps.repo.getStudent(input.studentId);
    if (student === null) {
      return null;
    }
    const section = await this.deps.orgRepo.getSection(input.sectionId);
    if (section === null) {
      throw new UnknownReferenceError(`sectionId "${input.sectionId}"`);
    }
    const sectionPath = await this.deps.orgRepo.pathForSection(input.sectionId);
    if (sectionPath === null || sectionPath.collegeId !== student.collegeId) {
      throw new UnknownReferenceError("section is not in the student's college");
    }
    const previous = await this.deps.repo.activeEnrollment(input.studentId, input.academicYear);
    if (previous?.startsOn && input.startsOn && input.startsOn <= previous.startsOn) {
      throw new InvalidEnrollmentDatesError("The transfer date must be after the previous enrollment began.");
    }
    const endsOn = input.startsOn ? new Date(Date.parse(`${input.startsOn}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : null;
    const enrollment = previous === null ? await this.deps.repo.createEnrollment(input)
      : await this.deps.repo.replaceEnrollment(previous.id, input, endsOn);
    return { enrollment, previous };
  }

  roster(sectionId: string) {
    return this.deps.repo.roster(sectionId);
  }

  getActiveEnrollment(studentId: string, academicYear: string): Promise<PplEnrollmentRow | null> {
    return this.deps.repo.activeEnrollment(studentId, academicYear);
  }

  latestActiveEnrollment(studentId: string): Promise<PplEnrollmentRow | null> {
    return this.deps.repo.latestActiveEnrollment(studentId);
  }

  listEnrollments(studentId: string): Promise<PplEnrollmentRow[]> {
    return this.deps.repo.listEnrollments(studentId);
  }

  async correctEnrollmentDates(studentId: string, enrollmentId: string, startsOn: string, endsOn: string | null, expectedStartsOn: string | null, expectedEndsOn: string | null): Promise<PplEnrollmentRow | null> {
    const records = await this.deps.repo.listEnrollments(studentId);
    const current = records.find((row) => row.id === enrollmentId);
    if (!current) return null;
    if (current.startsOn !== expectedStartsOn || current.endsOn !== expectedEndsOn) throw new EnrollmentConflictError();
    if (endsOn !== null && endsOn < startsOn) throw new InvalidEnrollmentDatesError("End date cannot precede start date.");
    if (current.status === "enrolled" && endsOn !== null) throw new InvalidEnrollmentDatesError("An active enrollment cannot have an end date.");
    if (current.status !== "enrolled" && endsOn === null) throw new InvalidEnrollmentDatesError("A past enrollment needs an end date.");
    for (const other of records) {
      if (other.id === enrollmentId || other.academicYear !== current.academicYear || !other.startsOn) continue;
      if (startsOn <= (other.endsOn ?? "9999-12-31") && other.startsOn <= (endsOn ?? "9999-12-31")) {
        throw new InvalidEnrollmentDatesError("Enrollment dates overlap another section for this pupil.");
      }
    }
    const updated = await this.deps.repo.updateEnrollmentDates(enrollmentId, startsOn, endsOn, expectedStartsOn, expectedEndsOn);
    if (!updated) throw new EnrollmentConflictError();
    return updated;
  }

  async enrollmentDisplay(enrollment: PplEnrollmentRow) {
    const section = await this.deps.orgRepo.getSection(enrollment.sectionId);
    const klass = section === null ? null : await this.deps.orgRepo.getClass(section.classId);
    return {
      id: enrollment.id,
      sectionId: enrollment.sectionId,
      sectionName: section?.name ?? "Unknown section",
      classId: section?.classId ?? null,
      className: klass?.name ?? "Unknown class",
      academicYear: enrollment.academicYear,
      status: enrollment.status,
      startsOn: enrollment.startsOn,
      endsOn: enrollment.endsOn,
      outcome: enrollment.outcome as "promoted" | "detained" | "transferred_out" | "graduated" | null,
      outcomeReason: enrollment.outcomeReason,
      createdAt: enrollment.createdAt.toISOString(),
      updatedAt: enrollment.updatedAt.toISOString(),
    };
  }

  async createTeacher(input: {
    collegeId: string;
    staffNo: string;
    fullName: string;
  }): Promise<PplTeacherRow> {
    if ((await this.deps.orgRepo.getCollege(input.collegeId)) === null) {
      throw new UnknownReferenceError(`collegeId "${input.collegeId}"`);
    }
    return this.deps.repo.createTeacher(input);
  }

  getTeacher(id: string): Promise<PplTeacherRow | null> {
    return this.deps.repo.getTeacher(id);
  }

  listTeachers(collegeId: string, options: { q?: string; offset: number; limit: number }) {
    return this.deps.repo.listTeachers(collegeId, options);
  }

  teacherForIdentity(userId: string): Promise<PplTeacherRow | null> {
    return this.deps.repo.findTeacherByIdentityUser(userId);
  }

  updateTeacher(
    id: string,
    patch: { fullName?: string; status?: PersonStatus },
  ): Promise<PplTeacherRow | null> {
    return this.deps.repo.updateTeacher(id, patch);
  }

  /** Sets (or clears) the opaque identity link. Grant sync is the caller's next step. */
  linkTeacherIdentity(id: string, identityUserId: string | null): Promise<PplTeacherRow | null> {
    return this.deps.repo.updateTeacher(id, { identityUserId });
  }
}
