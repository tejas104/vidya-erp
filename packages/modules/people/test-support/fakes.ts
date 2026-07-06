/**
 * In-memory TEST DOUBLES for the people module's unit tests. They mirror
 * the repos' documented semantics (uniqueness, RESTRICT deletes, the
 * one-live-enrollment rule) closely enough to exercise the services; the
 * real Drizzle repos are covered by the integration suite.
 */

import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditLogger, OrgPath } from "@vidya/platform";
import type {
  DerivedGrantInput,
  DerivedGrantView,
  DerivedGrantsApi,
} from "@vidya/module-identity";
import {
  DuplicateCodeError,
  UnitInUseError,
  type OrgRepo,
  type OrgTree,
  type OrgUnitType,
} from "../src/repo/org-repo";
import {
  DuplicateAssignmentError,
  DuplicatePersonError,
  type AssignmentKind,
  type PeopleRepo,
} from "../src/repo/people-repo";
import type { ImportsRepo, RowError } from "../src/repo/imports-repo";
import type {
  PplAssignmentRow,
  PplClassRow,
  PplCollegeRow,
  PplDepartmentRow,
  PplEnrollmentRow,
  PplImportRow,
  PplSectionRow,
  PplStudentRow,
  PplSubjectRow,
  PplTeacherRow,
} from "../src/db/schema";
import type { ImportObjectStore } from "../src/service/import-service";

const now = () => new Date();

export class RecordingAudit implements AuditLogger {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  actions(): string[] {
    return this.events.map((event) => event.action);
  }
}

// ---------------------------------------------------------------------------

export class InMemoryOrgRepo implements OrgRepo {
  readonly colleges = new Map<string, PplCollegeRow>();
  readonly departments = new Map<string, PplDepartmentRow>();
  readonly classes = new Map<string, PplClassRow>();
  readonly sections = new Map<string, PplSectionRow>();
  readonly subjects = new Map<string, PplSubjectRow>();

  async createCollege({ name, code }: { name: string; code: string }): Promise<PplCollegeRow> {
    for (const college of this.colleges.values()) {
      if (college.code === code) {
        throw new DuplicateCodeError("college", code);
      }
    }
    const row: PplCollegeRow = { id: `col_${randomUUID()}`, name, code, createdAt: now(), updatedAt: now() };
    this.colleges.set(row.id, row);
    return row;
  }

  async createDepartment(input: { collegeId: string; name: string; code: string }): Promise<PplDepartmentRow> {
    for (const department of this.departments.values()) {
      if (department.collegeId === input.collegeId && department.code === input.code) {
        throw new DuplicateCodeError("department", input.code);
      }
    }
    const row: PplDepartmentRow = { id: `dep_${randomUUID()}`, ...input, createdAt: now(), updatedAt: now() };
    this.departments.set(row.id, row);
    return row;
  }

  async createClass(input: { departmentId: string; name: string; code: string }): Promise<PplClassRow> {
    for (const classRow of this.classes.values()) {
      if (classRow.departmentId === input.departmentId && classRow.code === input.code) {
        throw new DuplicateCodeError("class", input.code);
      }
    }
    const row: PplClassRow = { id: `cls_${randomUUID()}`, ...input, createdAt: now(), updatedAt: now() };
    this.classes.set(row.id, row);
    return row;
  }

  async createSection(input: { classId: string; name: string }): Promise<PplSectionRow> {
    for (const section of this.sections.values()) {
      if (section.classId === input.classId && section.name === input.name) {
        throw new DuplicateCodeError("section", input.name);
      }
    }
    const row: PplSectionRow = { id: `sec_${randomUUID()}`, ...input, createdAt: now(), updatedAt: now() };
    this.sections.set(row.id, row);
    return row;
  }

  async createSubject(input: { departmentId: string; name: string; code: string }): Promise<PplSubjectRow> {
    for (const subject of this.subjects.values()) {
      if (subject.departmentId === input.departmentId && subject.code === input.code) {
        throw new DuplicateCodeError("subject", input.code);
      }
    }
    const row: PplSubjectRow = { id: `sub_${randomUUID()}`, ...input, createdAt: now(), updatedAt: now() };
    this.subjects.set(row.id, row);
    return row;
  }

  async getCollege(id: string): Promise<PplCollegeRow | null> {
    return this.colleges.get(id) ?? null;
  }
  async getDepartment(id: string): Promise<PplDepartmentRow | null> {
    return this.departments.get(id) ?? null;
  }
  async getClass(id: string): Promise<PplClassRow | null> {
    return this.classes.get(id) ?? null;
  }
  async getSection(id: string): Promise<PplSectionRow | null> {
    return this.sections.get(id) ?? null;
  }
  async getSubject(id: string): Promise<PplSubjectRow | null> {
    return this.subjects.get(id) ?? null;
  }
  async findCollegeByCode(code: string): Promise<PplCollegeRow | null> {
    for (const college of this.colleges.values()) {
      if (college.code === code) {
        return college;
      }
    }
    return null;
  }

  async listColleges(): Promise<PplCollegeRow[]> {
    return [...this.colleges.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listSectionsOfClass(classId: string): Promise<PplSectionRow[]> {
    return [...this.sections.values()]
      .filter((section) => section.classId === classId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTree(collegeId: string): Promise<OrgTree | null> {
    const college = this.colleges.get(collegeId);
    if (college === undefined) {
      return null;
    }
    const departments = [...this.departments.values()]
      .filter((department) => department.collegeId === collegeId)
      .map((department) => ({
        ...department,
        classes: [...this.classes.values()]
          .filter((classRow) => classRow.departmentId === department.id)
          .map((classRow) => ({
            ...classRow,
            sections: [...this.sections.values()].filter((section) => section.classId === classRow.id),
          })),
        subjects: [...this.subjects.values()].filter((subject) => subject.departmentId === department.id),
      }));
    return { college, departments };
  }

  async renameUnit(unitType: OrgUnitType, id: string, name: string): Promise<boolean> {
    const map = this.mapFor(unitType);
    const row = map.get(id);
    if (row === undefined) {
      return false;
    }
    (row as { name: string }).name = name;
    return true;
  }

  async deleteUnit(unitType: OrgUnitType, id: string): Promise<boolean> {
    const map = this.mapFor(unitType);
    if (!map.has(id)) {
      return false;
    }
    const hasChildren =
      (unitType === "college" &&
        [...this.departments.values()].some((department) => department.collegeId === id)) ||
      (unitType === "department" &&
        ([...this.classes.values()].some((classRow) => classRow.departmentId === id) ||
          [...this.subjects.values()].some((subject) => subject.departmentId === id))) ||
      (unitType === "class" && [...this.sections.values()].some((section) => section.classId === id));
    if (hasChildren) {
      throw new UnitInUseError(unitType);
    }
    map.delete(id);
    return true;
  }

  private mapFor(unitType: OrgUnitType): Map<string, { name: string }> {
    switch (unitType) {
      case "college":
        return this.colleges;
      case "department":
        return this.departments;
      case "class":
        return this.classes;
      case "section":
        return this.sections;
      case "subject":
        return this.subjects;
    }
  }

  async pathForDepartment(id: string): Promise<OrgPath | null> {
    const department = this.departments.get(id);
    return department === undefined
      ? null
      : { collegeId: department.collegeId, departmentId: department.id };
  }

  async pathForClass(id: string): Promise<OrgPath | null> {
    const classRow = this.classes.get(id);
    if (classRow === undefined) {
      return null;
    }
    const parent = await this.pathForDepartment(classRow.departmentId);
    return parent === null ? null : { ...parent, classId: classRow.id };
  }

  async pathForSection(id: string): Promise<OrgPath | null> {
    const section = this.sections.get(id);
    if (section === undefined) {
      return null;
    }
    const parent = await this.pathForClass(section.classId);
    return parent === null ? null : { ...parent, sectionId: section.id };
  }
}

// ---------------------------------------------------------------------------

export class InMemoryPeopleRepo implements PeopleRepo {
  readonly students = new Map<string, PplStudentRow>();
  readonly teachers = new Map<string, PplTeacherRow>();
  readonly enrollments = new Map<string, PplEnrollmentRow>();
  readonly assignments = new Map<string, PplAssignmentRow>();

  async createStudent(input: {
    collegeId: string;
    admissionNo: string;
    fullName: string;
    sourceImportId?: string;
  }): Promise<PplStudentRow> {
    for (const student of this.students.values()) {
      if (student.collegeId === input.collegeId && student.admissionNo === input.admissionNo) {
        throw new DuplicatePersonError("student", input.admissionNo);
      }
    }
    const row: PplStudentRow = {
      id: `stu_${randomUUID()}`,
      collegeId: input.collegeId,
      admissionNo: input.admissionNo,
      fullName: input.fullName,
      status: "active",
      sourceImportId: input.sourceImportId ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.students.set(row.id, row);
    return row;
  }

  async getStudent(id: string): Promise<PplStudentRow | null> {
    return this.students.get(id) ?? null;
  }

  async findStudentByAdmissionNo(collegeId: string, admissionNo: string): Promise<PplStudentRow | null> {
    for (const student of this.students.values()) {
      if (student.collegeId === collegeId && student.admissionNo === admissionNo) {
        return student;
      }
    }
    return null;
  }

  async findExistingAdmissionNos(collegeId: string, admissionNos: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(admissionNos);
    const existing = new Set<string>();
    for (const student of this.students.values()) {
      if (student.collegeId === collegeId && wanted.has(student.admissionNo)) {
        existing.add(student.admissionNo);
      }
    }
    return existing;
  }

  async findExistingStudentIds(studentIds: readonly string[]): Promise<Set<string>> {
    const existing = new Set<string>();
    for (const id of studentIds) {
      if (this.students.has(id)) {
        existing.add(id);
      }
    }
    return existing;
  }

  async sectionsWithLiveEnrollment(): Promise<string[]> {
    const sections = new Set<string>();
    for (const enrollment of this.enrollments.values()) {
      if (enrollment.status === "enrolled") {
        sections.add(enrollment.sectionId);
      }
    }
    return [...sections];
  }

  async findExistingStaffNos(collegeId: string, staffNos: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(staffNos);
    const existing = new Set<string>();
    for (const teacher of this.teachers.values()) {
      if (teacher.collegeId === collegeId && wanted.has(teacher.staffNo)) {
        existing.add(teacher.staffNo);
      }
    }
    return existing;
  }

  async updateStudent(
    id: string,
    patch: { fullName?: string; status?: "active" | "inactive" },
  ): Promise<PplStudentRow | null> {
    const student = this.students.get(id);
    if (student === undefined) {
      return null;
    }
    const updated = { ...student, ...patch, updatedAt: now() };
    this.students.set(id, updated);
    return updated;
  }

  async createTeacher(input: {
    collegeId: string;
    staffNo: string;
    fullName: string;
    sourceImportId?: string;
  }): Promise<PplTeacherRow> {
    for (const teacher of this.teachers.values()) {
      if (teacher.collegeId === input.collegeId && teacher.staffNo === input.staffNo) {
        throw new DuplicatePersonError("teacher", input.staffNo);
      }
    }
    const row: PplTeacherRow = {
      id: `tch_${randomUUID()}`,
      collegeId: input.collegeId,
      staffNo: input.staffNo,
      fullName: input.fullName,
      status: "active",
      identityUserId: null,
      sourceImportId: input.sourceImportId ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.teachers.set(row.id, row);
    return row;
  }

  async getTeacher(id: string): Promise<PplTeacherRow | null> {
    return this.teachers.get(id) ?? null;
  }

  async findTeacherByStaffNo(collegeId: string, staffNo: string): Promise<PplTeacherRow | null> {
    for (const teacher of this.teachers.values()) {
      if (teacher.collegeId === collegeId && teacher.staffNo === staffNo) {
        return teacher;
      }
    }
    return null;
  }

  async updateTeacher(
    id: string,
    patch: { fullName?: string; status?: "active" | "inactive"; identityUserId?: string | null },
  ): Promise<PplTeacherRow | null> {
    const teacher = this.teachers.get(id);
    if (teacher === undefined) {
      return null;
    }
    const updated = { ...teacher, ...patch, updatedAt: now() };
    this.teachers.set(id, updated);
    return updated;
  }

  async activeEnrollment(studentId: string, academicYear: string): Promise<PplEnrollmentRow | null> {
    for (const enrollment of this.enrollments.values()) {
      if (
        enrollment.studentId === studentId &&
        enrollment.academicYear === academicYear &&
        enrollment.status === "enrolled"
      ) {
        return enrollment;
      }
    }
    return null;
  }

  async latestActiveEnrollment(studentId: string): Promise<PplEnrollmentRow | null> {
    const active = [...this.enrollments.values()]
      .filter((enrollment) => enrollment.studentId === studentId && enrollment.status === "enrolled")
      .sort((a, b) => a.academicYear.localeCompare(b.academicYear));
    return active[active.length - 1] ?? null;
  }

  async withdrawEnrollment(enrollmentId: string): Promise<void> {
    const enrollment = this.enrollments.get(enrollmentId);
    if (enrollment !== undefined) {
      this.enrollments.set(enrollmentId, { ...enrollment, status: "withdrawn", updatedAt: now() });
    }
  }

  async createEnrollment(input: {
    studentId: string;
    sectionId: string;
    academicYear: string;
  }): Promise<PplEnrollmentRow> {
    if ((await this.activeEnrollment(input.studentId, input.academicYear)) !== null) {
      throw new Error("student already has a live enrollment for this academic year");
    }
    const row: PplEnrollmentRow = {
      id: `enr_${randomUUID()}`,
      studentId: input.studentId,
      sectionId: input.sectionId,
      academicYear: input.academicYear,
      status: "enrolled",
      createdAt: now(),
      updatedAt: now(),
    };
    this.enrollments.set(row.id, row);
    return row;
  }

  async roster(sectionId: string): Promise<{ enrollment: PplEnrollmentRow; student: PplStudentRow }[]> {
    const rows: { enrollment: PplEnrollmentRow; student: PplStudentRow }[] = [];
    for (const enrollment of this.enrollments.values()) {
      if (enrollment.sectionId === sectionId && enrollment.status === "enrolled") {
        const student = this.students.get(enrollment.studentId);
        if (student !== undefined) {
          rows.push({ enrollment, student });
        }
      }
    }
    return rows.sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));
  }

  async createAssignment(input: {
    teacherId: string;
    classId: string;
    subjectId?: string;
    kind: AssignmentKind;
    academicYear: string;
  }): Promise<PplAssignmentRow> {
    for (const assignment of this.assignments.values()) {
      const sameSubjectSlot =
        input.kind === "subject_teacher" &&
        assignment.kind === "subject_teacher" &&
        assignment.classId === input.classId &&
        assignment.subjectId === (input.subjectId ?? null) &&
        assignment.academicYear === input.academicYear;
      const sameClassTeacher =
        input.kind === "class_teacher" &&
        assignment.kind === "class_teacher" &&
        assignment.teacherId === input.teacherId &&
        assignment.classId === input.classId &&
        assignment.academicYear === input.academicYear;
      if (sameSubjectSlot || sameClassTeacher) {
        throw new DuplicateAssignmentError();
      }
    }
    const row: PplAssignmentRow = {
      id: `asg_${randomUUID()}`,
      teacherId: input.teacherId,
      classId: input.classId,
      subjectId: input.subjectId ?? null,
      kind: input.kind,
      academicYear: input.academicYear,
      createdAt: now(),
    };
    this.assignments.set(row.id, row);
    return row;
  }

  async getAssignment(id: string): Promise<PplAssignmentRow | null> {
    return this.assignments.get(id) ?? null;
  }

  async deleteAssignment(id: string): Promise<boolean> {
    return this.assignments.delete(id);
  }

  async assignmentsByClass(classId: string): Promise<PplAssignmentRow[]> {
    return [...this.assignments.values()].filter((assignment) => assignment.classId === classId);
  }

  async assignmentsByTeacher(teacherId: string): Promise<PplAssignmentRow[]> {
    return [...this.assignments.values()].filter((assignment) => assignment.teacherId === teacherId);
  }

  async listAllAssignments(): Promise<PplAssignmentRow[]> {
    return [...this.assignments.values()];
  }
}

// ---------------------------------------------------------------------------

export class InMemoryImportsRepo implements ImportsRepo {
  readonly rows = new Map<string, PplImportRow>();

  async create(input: {
    kind: "students" | "teachers";
    collegeId: string;
    academicYear?: string;
    dryRun: boolean;
    objectKey: string;
    requestedBy: string;
  }): Promise<PplImportRow> {
    const row: PplImportRow = {
      id: `imp_${randomUUID()}`,
      kind: input.kind,
      collegeId: input.collegeId,
      academicYear: input.academicYear ?? null,
      status: "pending",
      dryRun: input.dryRun,
      objectKey: input.objectKey,
      totalRows: 0,
      okRows: 0,
      errorRows: 0,
      errors: [],
      requestedBy: input.requestedBy,
      createdAt: now(),
      finishedAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async get(id: string): Promise<PplImportRow | null> {
    return this.rows.get(id) ?? null;
  }

  async markRunning(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row !== undefined) {
      this.rows.set(id, { ...row, status: "running" });
    }
  }

  async finish(
    id: string,
    outcome: {
      status: "completed" | "failed";
      totalRows: number;
      okRows: number;
      errorRows: number;
      errors: readonly RowError[];
    },
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row !== undefined) {
      this.rows.set(id, { ...row, ...outcome, errors: [...outcome.errors], finishedAt: now() });
    }
  }
}

// ---------------------------------------------------------------------------

export class MemoryObjectStore implements ImportObjectStore {
  readonly objects = new Map<string, string>();
  async putText(key: string, body: string): Promise<void> {
    this.objects.set(key, body);
  }
  async getText(key: string): Promise<string> {
    const body = this.objects.get(key);
    if (body === undefined) {
      throw new Error(`no such object ${key}`);
    }
    return body;
  }
}

// ---------------------------------------------------------------------------

/** Builds a minimal one-of-each org tree for tests. */
export async function seedOrg(org: InMemoryOrgRepo) {
  const college = await org.createCollege({ name: "Test College", code: "TC" });
  const department = await org.createDepartment({ collegeId: college.id, name: "Science", code: "SCI" });
  const classRow = await org.createClass({ departmentId: department.id, name: "BSc Year 1", code: "BSC1" });
  const section = await org.createSection({ classId: classRow.id, name: "A" });
  const subject = await org.createSubject({ departmentId: department.id, name: "Mathematics", code: "MATH" });
  return { college, department, classRow, section, subject };
}

// ---------------------------------------------------------------------------

/** Records derivation calls; can be told to fail the next upsert (compensation tests). */
export class FakeDerivedGrants implements DerivedGrantsApi {
  readonly bySourceRef = new Map<string, DerivedGrantInput>();
  failNextUpsert = false;

  async upsert(input: DerivedGrantInput): Promise<{ changed: boolean; grantId: string }> {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("identity unavailable (test)");
    }
    const existing = this.bySourceRef.get(input.sourceRef);
    const changed = JSON.stringify(existing) !== JSON.stringify(input);
    this.bySourceRef.set(input.sourceRef, input);
    return { changed, grantId: `grant-${input.sourceRef}` };
  }

  async removeBySourceRef(sourceRef: string): Promise<boolean> {
    return this.bySourceRef.delete(sourceRef);
  }

  async listBySourcePrefix(prefix: string): Promise<DerivedGrantView[]> {
    return [...this.bySourceRef.entries()]
      .filter(([sourceRef]) => sourceRef.startsWith(prefix))
      .map(([sourceRef, input]) => ({
        sourceRef,
        userId: input.userId,
        role: input.role,
        org: input.org,
        ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
      }));
  }
}
