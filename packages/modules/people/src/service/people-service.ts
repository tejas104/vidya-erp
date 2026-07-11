import type { OrgPath } from "@vidya/platform";
import type { OrgRepo } from "../repo/org-repo";
import type { PeopleRepo, PersonStatus } from "../repo/people-repo";
import type { PplEnrollmentRow, PplStudentRow, PplTeacherRow } from "../db/schema";

export class UnknownReferenceError extends Error {
  constructor(what: string) {
    super(`unknown reference: ${what}`);
    this.name = "UnknownReferenceError";
  }
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
    patch: { fullName?: string; status?: PersonStatus },
  ): Promise<PplStudentRow | null> {
    return this.deps.repo.updateStudent(id, patch);
  }

  /** W1 portal: link/unlink a student to an identity sign-in (mirrors teachers). */
  linkStudentIdentity(id: string, identityUserId: string | null): Promise<PplStudentRow | null> {
    return this.deps.repo.updateStudent(id, { identityUserId });
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
    if (previous !== null) {
      await this.deps.repo.withdrawEnrollment(previous.id);
    }
    const enrollment = await this.deps.repo.createEnrollment(input);
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
