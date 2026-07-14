import type { AuditLogger, Logger } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type {
  AttendanceRepo,
  AttendanceStatus,
  NewSession,
} from "../repo/attendance-repo";
import type { AcdEntryRow, AcdSessionRow } from "../db/schema";

export class UnknownSectionError extends Error {
  constructor(sectionId: string) {
    super(`unknown sectionId "${sectionId}"`);
    this.name = "UnknownSectionError";
  }
}

/** Entries naming students outside the section's live roster (422 at the route). */
export class InvalidEntriesError extends Error {
  constructor(readonly invalid: readonly { studentId: string; reason: string }[]) {
    super("one or more entries are invalid");
    this.name = "InvalidEntriesError";
  }
}

export interface AttendanceServiceDeps {
  readonly repo: AttendanceRepo;
  readonly directory: PeopleDirectory;
  readonly audit: AuditLogger;
  /** Metrics hook: called with the gap count when the daily scan finds any. */
  readonly onGaps?: (count: number) => void;
}

export interface SessionWithEntries {
  readonly session: AcdSessionRow;
  readonly entries: AcdEntryRow[];
}

export class AttendanceService {
  constructor(private readonly deps: AttendanceServiceDeps) {}

  /**
   * Resolves and returns the section's full path (used by the handler to
   * build the scope-check ResourceRef BEFORE anything is written).
   */
  async sectionPosition(sectionId: string) {
    const path = await this.deps.directory.sectionPath(sectionId);
    if (
      path === null ||
      path.departmentId === undefined ||
      path.classId === undefined ||
      path.sectionId === undefined
    ) {
      return null;
    }
    return {
      collegeId: path.collegeId,
      departmentId: path.departmentId,
      classId: path.classId,
      sectionId: path.sectionId,
    };
  }

  /**
   * Records a session with its entries. Every entry must belong to the
   * section's LIVE roster — attendance for students not in the section is
   * rejected as a batch (422) so the marksheet on the teacher's desk and
   * the system never silently disagree.
   */
  async recordSession(input: {
    sectionId: string;
    /** "" ⇒ whole-section session; a value ⇒ this subject teacher's period. */
    subjectId?: string;
    heldOn: string;
    slot: string;
    academicYear: string;
    takenBy: string;
    entries: readonly { studentId: string; status: AttendanceStatus }[];
  }): Promise<SessionWithEntries> {
    const position = await this.sectionPosition(input.sectionId);
    if (position === null) {
      throw new UnknownSectionError(input.sectionId);
    }
    const roster = new Set(
      (await this.deps.directory.sectionRoster(input.sectionId)).map((row) => row.studentId),
    );
    const seen = new Set<string>();
    const invalid: { studentId: string; reason: string }[] = [];
    for (const entry of input.entries) {
      if (seen.has(entry.studentId)) {
        invalid.push({ studentId: entry.studentId, reason: "duplicated in this request" });
        continue;
      }
      seen.add(entry.studentId);
      if (!roster.has(entry.studentId)) {
        invalid.push({ studentId: entry.studentId, reason: "not on this section's live roster" });
      }
    }
    if (invalid.length > 0) {
      throw new InvalidEntriesError(invalid);
    }
    const newSession: NewSession = {
      sectionId: input.sectionId,
      subjectId: input.subjectId ?? "",
      heldOn: input.heldOn,
      slot: input.slot,
      academicYear: input.academicYear,
      takenBy: input.takenBy,
      collegeId: position.collegeId,
      departmentId: position.departmentId,
      classId: position.classId,
      entries: input.entries,
    };
    const session = await this.deps.repo.createSession(newSession);
    const entries = await this.deps.repo.entriesForSession(session.id);
    return { session, entries };
  }

  getSession(id: string): Promise<AcdSessionRow | null> {
    return this.deps.repo.getSession(id);
  }

  async sessionWithEntries(id: string): Promise<SessionWithEntries | null> {
    const session = await this.deps.repo.getSession(id);
    if (session === null) {
      return null;
    }
    return { session, entries: await this.deps.repo.entriesForSession(id) };
  }

  correctEntry(
    sessionId: string,
    studentId: string,
    status: AttendanceStatus,
  ): Promise<{ before: AttendanceStatus } | null> {
    return this.deps.repo.updateEntryStatus(sessionId, studentId, status);
  }

  listSessions(
    sectionId: string,
    range: { from?: string; to?: string; limit: number },
  ): Promise<SessionWithEntries[]> {
    return this.deps.repo.listSessions(sectionId, range);
  }

  async studentExists(studentId: string): Promise<boolean> {
    return (await this.deps.directory.studentsExist([studentId])).has(studentId);
  }

  sessionsForStudent(studentId: string, academicYear?: string) {
    return this.deps.repo.sessionsForStudent(studentId, academicYear);
  }

  /**
   * The daily gap scan (worker job): sections with live enrollment that
   * have no session for the date. Audited when gaps exist so the office
   * has a durable record to chase; silent when the college is complete.
   */
  async gapScan(date: string, log: Logger): Promise<{ activeSections: number; missing: string[] }> {
    const active = await this.deps.directory.sectionsWithLiveEnrollment();
    const covered = await this.deps.repo.sectionsWithSessionOn(date, active);
    const missing = active.filter((sectionId) => !covered.has(sectionId));
    if (missing.length > 0) {
      this.deps.onGaps?.(missing.length);
      await this.deps.audit.record({
        module: "academics",
        action: "academics.attendance-gap-detected",
        actorType: "system",
        actorId: null,
        resourceType: "attendance-session",
        resourceId: null,
        requestId: null,
        details: {
          date,
          activeSections: active.length,
          missingCount: missing.length,
          missingSections: missing.slice(0, 100),
        },
      });
    }
    log.info({ date, active: active.length, missing: missing.length }, "attendance gap scan done");
    return { activeSections: active.length, missing };
  }
}
