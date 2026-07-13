/**
 * In-memory TEST DOUBLES for the academics module's unit tests. Repos
 * mirror documented semantics (uniqueness, RESTRICT, diffs); the
 * FakePeopleDirectory serves a small fixed org. The real Drizzle repos are
 * integration-covered; the real ScopeChecker is exercised by
 * src/scope-traces.test.ts and the integration suite.
 */

import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditLogger, OrgPath } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import {
  DuplicateSessionError,
  type AttendanceRepo,
  type AttendanceStatus,
  type NewSession,
} from "../src/repo/attendance-repo";
import {
  DuplicateAssessmentError,
  MarksExistError,
  type MarkDiff,
  type MarksRepo,
  type NewAssessment,
} from "../src/repo/marks-repo";
import type {
  AcdAssessmentRow,
  AcdEntryRow,
  AcdMarkRow,
  AcdSessionRow,
} from "../src/db/schema";

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
// A small fixed org: one college, one department, one class, two sections,
// two subjects, three students (two enrolled in section A, one in B).
// ---------------------------------------------------------------------------

export const ORG = {
  collegeId: "col_1",
  departmentId: "dep_sci",
  classId: "cls_10a",
  otherClassId: "cls_10b",
  sectionA: "sec_a",
  sectionB: "sec_b",
  mathId: "sub_math",
  physicsId: "sub_phys",
  studentA1: "stu_a1",
  studentA2: "stu_a2",
  studentB1: "stu_b1",
} as const;

export class FakePeopleDirectory implements PeopleDirectory {
  async sectionPath(sectionId: string): Promise<OrgPath | null> {
    if (sectionId === ORG.sectionA || sectionId === ORG.sectionB) {
      return {
        collegeId: ORG.collegeId,
        departmentId: ORG.departmentId,
        classId: ORG.classId,
        sectionId,
      };
    }
    return null;
  }

  async classPath(classId: string): Promise<OrgPath | null> {
    if (classId === ORG.classId || classId === ORG.otherClassId) {
      return { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId };
    }
    return null;
  }

  async departmentPath(departmentId: string): Promise<OrgPath | null> {
    return departmentId === ORG.departmentId
      ? { collegeId: ORG.collegeId, departmentId }
      : null;
  }

  async collegeExists(collegeId: string): Promise<boolean> {
    return collegeId === ORG.collegeId;
  }

  async sectionRoster(sectionId: string): Promise<{ studentId: string; academicYear: string }[]> {
    if (sectionId === ORG.sectionA) {
      return [
        { studentId: ORG.studentA1, academicYear: "2026-27" },
        { studentId: ORG.studentA2, academicYear: "2026-27" },
      ];
    }
    if (sectionId === ORG.sectionB) {
      return [{ studentId: ORG.studentB1, academicYear: "2026-27" }];
    }
    return [];
  }

  async studentByIdentityUser(): Promise<{
    studentId: string;
    collegeId: string;
    fullName: string;
    admissionNo: string;
    status: string;
  } | null> {
    return null;
  }

  async teacherByIdentityUser(): Promise<{ teacherId: string; collegeId: string; fullName: string } | null> {
    return null;
  }

  async studentPosition(studentId: string): Promise<OrgPath | null> {
    if (studentId === ORG.studentA1 || studentId === ORG.studentA2) {
      return {
        collegeId: ORG.collegeId,
        departmentId: ORG.departmentId,
        classId: ORG.classId,
        sectionId: ORG.sectionA,
      };
    }
    if (studentId === ORG.studentB1) {
      return {
        collegeId: ORG.collegeId,
        departmentId: ORG.departmentId,
        classId: ORG.classId,
        sectionId: ORG.sectionB,
      };
    }
    return null;
  }

  async studentsExist(studentIds: readonly string[]): Promise<Set<string>> {
    const known = new Set<string>([ORG.studentA1, ORG.studentA2, ORG.studentB1]);
    return new Set(studentIds.filter((id) => known.has(id)));
  }

  async teacherDepartments(): Promise<string[]> {
    return [ORG.departmentId];
  }

  async studentsBrief(
    studentIds: readonly string[],
  ): Promise<Map<string, { fullName: string; admissionNo: string }>> {
    const known = new Set<string>([ORG.studentA1, ORG.studentA2, ORG.studentB1]);
    const briefs = new Map<string, { fullName: string; admissionNo: string }>();
    for (const id of studentIds) {
      if (known.has(id)) briefs.set(id, { fullName: `Student ${id}`, admissionNo: id });
    }
    return briefs;
  }

  async subjectDepartment(subjectId: string): Promise<string | null> {
    return subjectId === ORG.mathId || subjectId === ORG.physicsId ? ORG.departmentId : null;
  }

  async sectionsWithLiveEnrollment(): Promise<string[]> {
    return [ORG.sectionA, ORG.sectionB];
  }

  async sectionsOfClass(classId: string): Promise<{ sectionId: string; name: string }[]> {
    if (classId === ORG.classId) {
      return [
        { sectionId: ORG.sectionA, name: "A" },
        { sectionId: ORG.sectionB, name: "B" },
      ];
    }
    return [];
  }

  async departmentsOfCollege(): Promise<{ departmentId: string; name: string }[]> {
    return [];
  }
  async classesOfDepartment(): Promise<{ classId: string; name: string }[]> {
    return [];
  }

  async namesFor(ids: readonly string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>([
      [ORG.collegeId, "Test College"],
      [ORG.departmentId, "Science"],
      [ORG.classId, "BSc Year 1"],
      [ORG.otherClassId, "BSc Year 2"],
      [ORG.sectionA, "A"],
      [ORG.sectionB, "B"],
      [ORG.mathId, "Mathematics"],
      [ORG.physicsId, "Physics"],
      [ORG.studentA1, "Meera Nair"],
      [ORG.studentA2, "Ravi Kumar"],
      [ORG.studentB1, "Asha Verma"],
    ]);
    return new Map(ids.filter((id) => names.has(id)).map((id) => [id, names.get(id)!]));
  }
}

// ---------------------------------------------------------------------------

export class InMemoryAttendanceRepo implements AttendanceRepo {
  readonly sessions = new Map<string, AcdSessionRow>();
  readonly entries = new Map<string, AcdEntryRow>();

  async createSession(input: NewSession): Promise<AcdSessionRow> {
    for (const session of this.sessions.values()) {
      if (
        session.sectionId === input.sectionId &&
        session.heldOn === input.heldOn &&
        session.slot === input.slot
      ) {
        throw new DuplicateSessionError();
      }
    }
    const session: AcdSessionRow = {
      id: `ses_${randomUUID()}`,
      sectionId: input.sectionId,
      heldOn: input.heldOn,
      slot: input.slot,
      academicYear: input.academicYear,
      takenBy: input.takenBy,
      collegeId: input.collegeId,
      departmentId: input.departmentId,
      classId: input.classId,
      createdAt: now(),
    };
    this.sessions.set(session.id, session);
    for (const entry of input.entries) {
      const row: AcdEntryRow = {
        id: `ate_${randomUUID()}`,
        sessionId: session.id,
        studentId: entry.studentId,
        status: entry.status,
        createdAt: now(),
        updatedAt: now(),
      };
      this.entries.set(row.id, row);
    }
    return session;
  }

  async getSession(id: string): Promise<AcdSessionRow | null> {
    return this.sessions.get(id) ?? null;
  }

  async entriesForSession(sessionId: string): Promise<AcdEntryRow[]> {
    return [...this.entries.values()].filter((entry) => entry.sessionId === sessionId);
  }

  async listSessions(
    sectionId: string,
    range: { from?: string; to?: string; limit: number },
  ): Promise<{ session: AcdSessionRow; entries: AcdEntryRow[] }[]> {
    const sessions = [...this.sessions.values()]
      .filter(
        (session) =>
          session.sectionId === sectionId &&
          (range.from === undefined || session.heldOn >= range.from) &&
          (range.to === undefined || session.heldOn <= range.to),
      )
      .sort((a, b) => b.heldOn.localeCompare(a.heldOn))
      .slice(0, range.limit);
    const result = [];
    for (const session of sessions) {
      result.push({ session, entries: await this.entriesForSession(session.id) });
    }
    return result;
  }

  async updateEntryStatus(
    sessionId: string,
    studentId: string,
    status: AttendanceStatus,
  ): Promise<{ before: AttendanceStatus } | null> {
    for (const [id, entry] of this.entries) {
      if (entry.sessionId === sessionId && entry.studentId === studentId) {
        this.entries.set(id, { ...entry, status, updatedAt: now() });
        return { before: entry.status as AttendanceStatus };
      }
    }
    return null;
  }

  async sessionsForStudent(
    studentId: string,
    academicYear?: string,
  ): Promise<{ session: AcdSessionRow; entry: AcdEntryRow }[]> {
    const result = [];
    for (const entry of this.entries.values()) {
      if (entry.studentId !== studentId) {
        continue;
      }
      const session = this.sessions.get(entry.sessionId);
      if (session === undefined) {
        continue;
      }
      if (academicYear !== undefined && session.academicYear !== academicYear) {
        continue;
      }
      result.push({ session, entry });
    }
    return result.sort((a, b) => b.session.heldOn.localeCompare(a.session.heldOn));
  }

  async sectionsWithSessionOn(date: string, sectionIds: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(sectionIds);
    const found = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.heldOn === date && wanted.has(session.sectionId)) {
        found.add(session.sectionId);
      }
    }
    return found;
  }

  async pageEntries(
    academicYear: string,
    afterEntryId: string | null,
    limit: number,
  ): Promise<{ session: AcdSessionRow; entry: AcdEntryRow }[]> {
    const rows: { session: AcdSessionRow; entry: AcdEntryRow }[] = [];
    for (const entry of [...this.entries.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const session = this.sessions.get(entry.sessionId);
      if (session === undefined || session.academicYear !== academicYear) {
        continue;
      }
      if (afterEntryId !== null && entry.id <= afterEntryId) {
        continue;
      }
      rows.push({ session, entry });
      if (rows.length === limit) {
        break;
      }
    }
    return rows;
  }

  async recentSessionDensity(
    sectionId: string,
    limit: number,
  ): Promise<{ heldOn: string; slot: string; presentPct: number; students: number }[]> {
    const sessions = [...this.sessions.values()]
      .filter((session) => session.sectionId === sectionId)
      .sort((a, b) => b.heldOn.localeCompare(a.heldOn))
      .slice(0, limit);
    const result = [];
    for (const session of sessions) {
      const entries = await this.entriesForSession(session.id);
      const present = entries.filter(
        (entry) => entry.status === "present" || entry.status === "late",
      ).length;
      result.push({
        heldOn: session.heldOn,
        slot: session.slot,
        presentPct: entries.length === 0 ? 0 : Math.round((present / entries.length) * 100),
        students: entries.length,
      });
    }
    return result;
  }
}

// ---------------------------------------------------------------------------

export class InMemoryMarksRepo implements MarksRepo {
  readonly assessments = new Map<string, AcdAssessmentRow>();
  readonly marks = new Map<string, AcdMarkRow>();

  async createAssessment(input: NewAssessment): Promise<AcdAssessmentRow> {
    for (const assessment of this.assessments.values()) {
      if (
        assessment.classId === input.classId &&
        assessment.subjectId === input.subjectId &&
        assessment.academicYear === input.academicYear &&
        assessment.name === input.name
      ) {
        throw new DuplicateAssessmentError();
      }
    }
    const row: AcdAssessmentRow = {
      id: `asm_${randomUUID()}`,
      classId: input.classId,
      subjectId: input.subjectId,
      kind: input.kind,
      name: input.name,
      academicYear: input.academicYear,
      maxScore: input.maxScore.toFixed(2),
      heldOn: input.heldOn ?? null,
      collegeId: input.collegeId,
      departmentId: input.departmentId,
      createdBy: input.createdBy,
      createdAt: now(),
    };
    this.assessments.set(row.id, row);
    return row;
  }

  async getAssessment(id: string): Promise<AcdAssessmentRow | null> {
    return this.assessments.get(id) ?? null;
  }

  async deleteAssessment(id: string): Promise<boolean> {
    if (!this.assessments.has(id)) {
      return false;
    }
    for (const mark of this.marks.values()) {
      if (mark.assessmentId === id) {
        throw new MarksExistError();
      }
    }
    return this.assessments.delete(id);
  }

  async listAssessmentsByClass(classId: string, academicYear?: string): Promise<AcdAssessmentRow[]> {
    return [...this.assessments.values()].filter(
      (assessment) =>
        assessment.classId === classId &&
        (academicYear === undefined || assessment.academicYear === academicYear),
    );
  }

  async upsertMarks(
    assessmentId: string,
    entries: readonly { studentId: string; score: number }[],
    recordedBy: string,
  ): Promise<MarkDiff[]> {
    const diffs: MarkDiff[] = [];
    for (const entry of entries) {
      const existing = [...this.marks.values()].find(
        (mark) => mark.assessmentId === assessmentId && mark.studentId === entry.studentId,
      );
      if (existing === undefined) {
        const row: AcdMarkRow = {
          id: `mrk_${randomUUID()}`,
          assessmentId,
          studentId: entry.studentId,
          score: entry.score.toFixed(2),
          recordedBy,
          createdAt: now(),
          updatedAt: now(),
        };
        this.marks.set(row.id, row);
        diffs.push({ studentId: entry.studentId, before: null, after: entry.score, changed: true });
      } else {
        const before = Number(existing.score);
        if (before === entry.score) {
          diffs.push({ studentId: entry.studentId, before, after: entry.score, changed: false });
          continue;
        }
        this.marks.set(existing.id, {
          ...existing,
          score: entry.score.toFixed(2),
          recordedBy,
          updatedAt: now(),
        });
        diffs.push({ studentId: entry.studentId, before, after: entry.score, changed: true });
      }
    }
    return diffs;
  }

  async getMark(id: string): Promise<AcdMarkRow | null> {
    return this.marks.get(id) ?? null;
  }

  async updateMark(
    id: string,
    score: number,
    recordedBy: string,
  ): Promise<{ before: number; after: number } | null> {
    const existing = this.marks.get(id);
    if (existing === undefined) {
      return null;
    }
    this.marks.set(id, { ...existing, score: score.toFixed(2), recordedBy, updatedAt: now() });
    return { before: Number(existing.score), after: score };
  }

  async marksForAssessment(assessmentId: string): Promise<AcdMarkRow[]> {
    return [...this.marks.values()].filter((mark) => mark.assessmentId === assessmentId);
  }

  async pageMarks(
    academicYear: string,
    afterMarkId: string | null,
    limit: number,
  ): Promise<{ mark: AcdMarkRow; assessment: AcdAssessmentRow }[]> {
    const rows: { mark: AcdMarkRow; assessment: AcdAssessmentRow }[] = [];
    for (const mark of [...this.marks.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const assessment = this.assessments.get(mark.assessmentId);
      if (assessment === undefined || assessment.academicYear !== academicYear) {
        continue;
      }
      if (afterMarkId !== null && mark.id <= afterMarkId) {
        continue;
      }
      rows.push({ mark, assessment });
      if (rows.length === limit) {
        break;
      }
    }
    return rows;
  }

  async marksForStudent(
    studentId: string,
    filter: { academicYear?: string; subjectId?: string },
  ): Promise<{ mark: AcdMarkRow; assessment: AcdAssessmentRow }[]> {
    const result = [];
    for (const mark of this.marks.values()) {
      if (mark.studentId !== studentId) {
        continue;
      }
      const assessment = this.assessments.get(mark.assessmentId);
      if (assessment === undefined) {
        continue;
      }
      if (filter.academicYear !== undefined && assessment.academicYear !== filter.academicYear) {
        continue;
      }
      if (filter.subjectId !== undefined && assessment.subjectId !== filter.subjectId) {
        continue;
      }
      result.push({ mark, assessment });
    }
    return result;
  }
}
