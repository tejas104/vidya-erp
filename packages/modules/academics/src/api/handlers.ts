import type {
  AccessAction,
  Principal,
  ResourceRef,
  RouteContext,
  RouteHandler,
  RouteResult,
  ScopeChecker,
} from "@vidya/platform";
import {
  AttendanceService,
  InvalidEntriesError,
  UnknownSectionError,
} from "../service/attendance-service";
import {
  MarksService,
  ScoreExceedsMaxError,
  SubjectOutsideDepartmentError,
  UnknownClassError,
} from "../service/marks-service";
import { DuplicateSessionError, type AttendanceStatus } from "../repo/attendance-repo";
import { DuplicateAssessmentError, MarksExistError } from "../repo/marks-repo";
import { attendanceRef, marksRef } from "../resource-refs";
import type { AcdAssessmentRow, AcdEntryRow, AcdMarkRow, AcdSessionRow } from "../db/schema";

/** What the mark-history endpoint needs from the system module's audit read-back. */
export interface AuditHistoryEntry {
  readonly action: string;
  readonly actorId: string | null;
  readonly occurredAt: Date;
  readonly details: unknown;
}

export interface AcademicsHandlerDeps {
  readonly attendance: AttendanceService;
  readonly marks: MarksService;
  readonly scopeChecker: ScopeChecker;
  readonly readAudit: (
    resourceType: string,
    resourceId: string,
    limit: number,
  ) => Promise<AuditHistoryEntry[]>;
}

function denied(ctx: RouteContext, reason: string): RouteResult {
  ctx.logger.warn({ reason }, "scope check denied");
  return { status: 403, body: { message: "access denied" } };
}

function notFound(): RouteResult {
  return { status: 404, body: { message: "not found" } };
}

/** The chokepoint: every record decision in this module flows through here. */
function checkScope(
  scopeChecker: ScopeChecker,
  ctx: RouteContext,
  principal: Principal,
  action: AccessAction,
  resource: ResourceRef,
): { ok: true } | { ok: false; result: RouteResult } {
  const decision = scopeChecker.check(principal, action, resource);
  if (!decision.granted) {
    return { ok: false, result: denied(ctx, decision.reason) };
  }
  return { ok: true };
}

function mapKnownErrors(error: unknown): RouteResult | null {
  if (error instanceof DuplicateSessionError || error instanceof DuplicateAssessmentError) {
    return { status: 409, body: { message: error.message } };
  }
  if (error instanceof MarksExistError) {
    return { status: 409, body: { message: error.message } };
  }
  if (error instanceof InvalidEntriesError) {
    return { status: 422, body: { message: error.message, invalid: error.invalid } };
  }
  if (error instanceof ScoreExceedsMaxError || error instanceof SubjectOutsideDepartmentError) {
    return { status: 422, body: { message: error.message } };
  }
  if (error instanceof UnknownSectionError || error instanceof UnknownClassError) {
    return { status: 404, body: { message: error.message } };
  }
  return null;
}

function sessionView(session: AcdSessionRow, entries: AcdEntryRow[]) {
  return {
    id: session.id,
    sectionId: session.sectionId,
    heldOn: session.heldOn,
    slot: session.slot,
    academicYear: session.academicYear,
    takenBy: session.takenBy,
    entries: entries.map((entry) => ({ studentId: entry.studentId, status: entry.status })),
  };
}

function assessmentView(assessment: AcdAssessmentRow) {
  return {
    id: assessment.id,
    classId: assessment.classId,
    subjectId: assessment.subjectId,
    kind: assessment.kind,
    name: assessment.name,
    academicYear: assessment.academicYear,
    maxScore: Number(assessment.maxScore),
    heldOn: assessment.heldOn,
  };
}

function markView(mark: AcdMarkRow) {
  return {
    id: mark.id,
    assessmentId: mark.assessmentId,
    studentId: mark.studentId,
    score: Number(mark.score),
    recordedBy: mark.recordedBy,
    updatedAt: mark.updatedAt.toISOString(),
  };
}

function countEntries(entries: AcdEntryRow[]) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const entry of entries) {
    counts[entry.status as AttendanceStatus] += 1;
  }
  return counts;
}

export function createAcademicsHandlers(deps: AcademicsHandlerDeps): Record<string, RouteHandler> {
  const attendanceRecord: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      sectionId: string;
      heldOn: string;
      slot: string;
      academicYear: string;
      entries: { studentId: string; status: AttendanceStatus }[];
    };
    const position = await deps.attendance.sectionPosition(body.sectionId);
    if (position === null) {
      return notFound();
    }
    // One ref covers the whole batch: every entry lives at the session's path.
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", attendanceRef(position));
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const { session, entries } = await deps.attendance.recordSession({
        ...body,
        takenBy: principal.id,
      });
      return {
        status: 201,
        body: sessionView(session, entries),
        audit: {
          resourceId: session.id,
          details: {
            sectionId: session.sectionId,
            heldOn: session.heldOn,
            slot: session.slot,
            counts: countEntries(entries),
          },
        },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const attendanceCorrect: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { sessionId: string; studentId: string };
    const body = ctx.request.body as { status: AttendanceStatus };
    const session = await deps.attendance.getSession(params.sessionId);
    if (session === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", attendanceRef(session));
    if (!scope.ok) {
      return scope.result;
    }
    const result = await deps.attendance.correctEntry(params.sessionId, params.studentId, body.status);
    if (result === null) {
      return notFound();
    }
    return {
      status: 200,
      body: { studentId: params.studentId, status: body.status },
      audit: {
        resourceId: `${params.sessionId}/${params.studentId}`,
        details: {
          sessionId: params.sessionId,
          studentId: params.studentId,
          before: result.before,
          after: body.status,
        },
      },
    };
  };

  const attendanceSessionGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { sessionId: string };
    const found = await deps.attendance.sessionWithEntries(params.sessionId);
    if (found === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", attendanceRef(found.session));
    if (!scope.ok) {
      return scope.result;
    }
    return { status: 200, body: sessionView(found.session, found.entries) };
  };

  const sectionAttendance: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { sectionId: string };
    const query = ctx.request.query as { from?: string; to?: string; limit: number };
    const position = await deps.attendance.sectionPosition(params.sectionId);
    if (position === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", attendanceRef(position));
    if (!scope.ok) {
      return scope.result;
    }
    const sessions = await deps.attendance.listSessions(params.sectionId, query);
    return {
      status: 200,
      body: {
        sessions: sessions.map(({ session, entries }) => ({
          id: session.id,
          heldOn: session.heldOn,
          slot: session.slot,
          academicYear: session.academicYear,
          counts: countEntries(entries),
        })),
      },
    };
  };

  const studentAttendance: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { studentId: string };
    const query = ctx.request.query as { academicYear?: string };
    if (!(await deps.attendance.studentExists(params.studentId))) {
      return notFound();
    }
    const rows = await deps.attendance.sessionsForStudent(params.studentId, query.academicYear);
    // Row-filter: each session is checked at its own stored org path.
    const granted = rows.filter(
      (row) =>
        deps.scopeChecker.check(principal, "read", attendanceRef(row.session)).granted,
    );
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const row of granted) {
      counts[row.entry.status as AttendanceStatus] += 1;
    }
    return {
      status: 200,
      body: {
        sessions: granted.map((row) => ({
          sessionId: row.session.id,
          sectionId: row.session.sectionId,
          heldOn: row.session.heldOn,
          slot: row.session.slot,
          status: row.entry.status,
        })),
        counts,
      },
    };
  };

  const assessmentCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      classId: string;
      subjectId: string;
      kind: "exam" | "quiz" | "assignment";
      name: string;
      academicYear: string;
      maxScore: number;
      heldOn?: string;
    };
    const position = await deps.marks.classPosition(body.classId);
    if (position === null) {
      return notFound();
    }
    const scope = checkScope(
      deps.scopeChecker,
      ctx,
      principal,
      "create",
      marksRef({ ...position, subjectId: body.subjectId }, "assessment"),
    );
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const created = await deps.marks.createAssessment({ ...body, createdBy: principal.id });
      return {
        status: 201,
        body: assessmentView(created),
        audit: {
          resourceId: created.id,
          details: {
            classId: created.classId,
            subjectId: created.subjectId,
            kind: created.kind,
            name: created.name,
            academicYear: created.academicYear,
            maxScore: Number(created.maxScore),
          },
        },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const assessmentDelete: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { assessmentId: string };
    const assessment = await deps.marks.getAssessment(params.assessmentId);
    if (assessment === null) {
      return notFound();
    }
    const scope = checkScope(
      deps.scopeChecker,
      ctx,
      principal,
      "delete",
      marksRef(assessment, "assessment"),
    );
    if (!scope.ok) {
      return scope.result;
    }
    try {
      if (!(await deps.marks.deleteAssessment(params.assessmentId))) {
        return notFound();
      }
    } catch (error) {
      const mapped = mapKnownErrors(error);
      if (mapped !== null) {
        return mapped;
      }
      throw error;
    }
    return {
      status: 200,
      body: { ok: true as const },
      audit: {
        resourceId: params.assessmentId,
        details: { classId: assessment.classId, subjectId: assessment.subjectId, name: assessment.name },
      },
    };
  };

  const classAssessments: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const query = ctx.request.query as { academicYear?: string };
    const position = await deps.marks.classPosition(params.classId);
    if (position === null) {
      return notFound();
    }
    const all = await deps.marks.listAssessments(params.classId, query.academicYear);
    // Row-filter by subject scope: a subject teacher sees only their own
    // subject's assessments; class_teacher/hod/principal/admin see all.
    const granted = all.filter(
      (assessment) => deps.scopeChecker.check(principal, "read", marksRef(assessment, "assessment")).granted,
    );
    return { status: 200, body: { assessments: granted.map(assessmentView) } };
  };

  const assessmentGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { assessmentId: string };
    const assessment = await deps.marks.getAssessment(params.assessmentId);
    if (assessment === null) {
      return notFound();
    }
    const scope = checkScope(
      deps.scopeChecker,
      ctx,
      principal,
      "read",
      marksRef(assessment, "assessment"),
    );
    if (!scope.ok) {
      return scope.result;
    }
    return { status: 200, body: assessmentView(assessment) };
  };

  const marksEnter: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { assessmentId: string };
    const body = ctx.request.body as { entries: { studentId: string; score: number }[] };
    const assessment = await deps.marks.getAssessment(params.assessmentId);
    if (assessment === null) {
      return notFound();
    }
    // One ref covers the batch: every mark carries this assessment's
    // class path + subjectId.
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", marksRef(assessment));
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const diffs = await deps.marks.enterMarks(assessment, body.entries, principal.id);
      const created = diffs.filter((diff) => diff.before === null).length;
      const updated = diffs.filter((diff) => diff.changed && diff.before !== null).length;
      const unchanged = diffs.filter((diff) => !diff.changed).length;
      return {
        status: 200,
        body: { created, updated, unchanged },
        audit: {
          resourceId: assessment.id,
          details: {
            subjectId: assessment.subjectId,
            classId: assessment.classId,
            created,
            updated,
            unchanged,
            // The grade-change trail: per-entry before/after (capped).
            changes: diffs
              .filter((diff) => diff.changed)
              .slice(0, 100)
              .map((diff) => ({ studentId: diff.studentId, before: diff.before, after: diff.after })),
          },
        },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const markCorrect: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { markId: string };
    const body = ctx.request.body as { score: number };
    const mark = await deps.marks.getMark(params.markId);
    if (mark === null) {
      return notFound();
    }
    const assessment = await deps.marks.getAssessment(mark.assessmentId);
    if (assessment === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", marksRef(assessment));
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const diff = await deps.marks.correctMark(mark, assessment, body.score, principal.id);
      const updated = await deps.marks.getMark(params.markId);
      return {
        status: 200,
        body: markView(updated ?? mark),
        audit: {
          resourceId: mark.id,
          details: {
            assessmentId: assessment.id,
            subjectId: assessment.subjectId,
            studentId: mark.studentId,
            before: diff.before,
            after: diff.after,
          },
        },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const assessmentMarks: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { assessmentId: string };
    const assessment = await deps.marks.getAssessment(params.assessmentId);
    if (assessment === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", marksRef(assessment));
    if (!scope.ok) {
      return scope.result;
    }
    const marks = await deps.marks.marksForAssessment(params.assessmentId);
    return { status: 200, body: { marks: marks.map(markView) } };
  };

  const studentMarks: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { studentId: string };
    const query = ctx.request.query as { academicYear?: string; subjectId?: string };
    if (!(await deps.marks.studentExists(params.studentId))) {
      return notFound();
    }
    const rows = await deps.marks.marksForStudent(params.studentId, query);
    // Row-filter: each mark is checked at ITS assessment's path + subject.
    const granted = rows.filter(
      (row) => deps.scopeChecker.check(principal, "read", marksRef(row.assessment)).granted,
    );
    return {
      status: 200,
      body: {
        marks: granted.map((row) => ({
          mark: markView(row.mark),
          assessment: assessmentView(row.assessment),
        })),
      },
    };
  };

  const markHistory: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { markId: string };
    const mark = await deps.marks.getMark(params.markId);
    if (mark === null) {
      return notFound();
    }
    const assessment = await deps.marks.getAssessment(mark.assessmentId);
    if (assessment === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", marksRef(assessment));
    if (!scope.ok) {
      return scope.result;
    }
    // The mark's own corrections, plus bulk entries on its assessment
    // (which carry per-student diffs in their details).
    const [corrections, bulkEntries] = await Promise.all([
      deps.readAudit("mark", mark.id, 200),
      deps.readAudit("assessment", assessment.id, 200),
    ]);
    const history = [...corrections, ...bulkEntries]
      .filter((event) =>
        event.action === "academics.mark-corrected" ||
        event.action === "academics.marks-entered",
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map((event) => ({
        action: event.action,
        actorId: event.actorId,
        occurredAt: event.occurredAt.toISOString(),
        details: (event.details ?? {}) as Record<string, unknown>,
      }));
    return { status: 200, body: { history } };
  };

  return {
    "academics.attendance-record": attendanceRecord,
    "academics.attendance-correct": attendanceCorrect,
    "academics.attendance-session-get": attendanceSessionGet,
    "academics.section-attendance": sectionAttendance,
    "academics.student-attendance": studentAttendance,
    "academics.assessment-create": assessmentCreate,
    "academics.assessment-delete": assessmentDelete,
    "academics.class-assessments": classAssessments,
    "academics.assessment-get": assessmentGet,
    "academics.marks-enter": marksEnter,
    "academics.mark-correct": markCorrect,
    "academics.assessment-marks": assessmentMarks,
    "academics.student-marks": studentMarks,
    "academics.mark-history": markHistory,
  };
}
