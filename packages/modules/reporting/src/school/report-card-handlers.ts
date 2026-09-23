import type {
  OrgPath,
  Principal,
  ResourceRef,
  RouteHandler,
  ScopeChecker,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { SchoolAcademicsReadModel } from "@vidya/module-school-academics";
import { ReportCardBuildError, type ReportCardBuilder } from "./report-card-service";
import { renderReportCardPdf } from "./report-card-pdf";
import type { ReportCardRepo } from "./report-card-repo";
import { parseStoredSnapshot } from "./report-card-contract";

/**
 * Transport for school report cards. Thin by design: it resolves the target's
 * TRUSTED org path on the server, scope-checks it, and delegates every
 * calculation to the builder.
 *
 * AUTHORIZATION RULE FOR ALL FOUR ROUTES. Nothing in the request is trusted as
 * authority. The class id, pupil id and snapshot id are identifiers used to
 * LOOK UP a position, and the position is what the scope checker decides on.
 * A pupil's org path comes from their enrollment, and a snapshot's from the
 * row recorded at issue time — never from the caller.
 */

function fail(status: number, message: string) {
  return { status, body: { message } };
}

/** A report card discloses one pupil's full academic standing, so it is
 *  authorized against the pupil's own resolved position, not merely their
 *  class. */
function studentRef(org: OrgPath): ResourceRef {
  return { module: "reporting", resourceType: "student", org };
}
function classRef(org: OrgPath): ResourceRef {
  return { module: "reporting", resourceType: "class", org };
}

export interface ReportCardHandlerDeps {
  readonly builder: ReportCardBuilder;
  readonly repo: ReportCardRepo;
  readonly schoolAcademics: SchoolAcademicsReadModel;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
}

export function createSchoolReportCardHandlers(
  deps: ReportCardHandlerDeps,
): Record<string, RouteHandler> {
  /**
   * Resolves a pupil to the position a report card may be issued against, and
   * authorizes the caller for `action` on it. Returns a failure response
   * instead of a position when the caller may not proceed.
   */
  async function authorizeStudent(
    principal: Principal,
    studentId: string,
  ): Promise<
    | { ok: true; org: OrgPath & { departmentId: string; classId: string } }
    | { ok: false; response: ReturnType<typeof fail> }
  > {
    const org = await deps.directory.studentPosition(studentId);
    if (org === null) return { ok: false, response: fail(404, "no such student") };

    // `studentPosition` returns `{collegeId}` alone for an unenrolled pupil.
    // Authorize on that college BEFORE saying so: answering 422 first would
    // let an unauthorized caller tell "no such pupil" (404) from "exists but
    // unenrolled" (422) by walking ids. The 422 is then an honest answer to a
    // caller who is entitled to ask.
    if (org.departmentId === undefined || org.classId === undefined) {
      if (!deps.scopeChecker.check(principal, "read", studentRef(org)).granted) {
        return { ok: false, response: fail(403, "access denied") };
      }
      return {
        ok: false,
        response: fail(422, "This pupil is not enrolled in a class, so no report card can be prepared."),
      };
    }
    // "read", not "create" — the same rule the queued /api/v1/reports flow
    // applies. Producing a report is gated by the authority to READ the
    // records it discloses; the row this writes belongs to reporting's own
    // append-only log, not to the pupil's academic record. The approved
    // role/scope matrix (ADR-0010, human-owned core) deliberately grants
    // `create` only on identity and people, so no role could issue a report
    // card under a `create` check — including the class teacher whose job it
    // actually is.
    if (!deps.scopeChecker.check(principal, "read", studentRef(org)).granted) {
      return { ok: false, response: fail(403, "access denied") };
    }
    return { ok: true, org: org as OrgPath & { departmentId: string; classId: string } };
  }

  /** Confirms a term exists and belongs to the same school as the resolved
   *  position — an academic-relationship check, not an access decision. */
  async function requireTermOf(termId: string, org: OrgPath) {
    const term = await deps.schoolAcademics.getTerm(termId);
    if (term === null) return { ok: false as const, response: fail(404, "no such term") };
    if (term.collegeId !== org.collegeId) {
      return {
        ok: false as const,
        response: fail(422, "That term belongs to a different school."),
      };
    }
    return { ok: true as const, term };
  }

  const roster: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const { classId } = ctx.request.params as { classId: string };
    const { termId } = ctx.request.query as { termId: string };

    const org = await deps.directory.classPath(classId);
    if (org === null) return fail(404, "no such class");
    if (!deps.scopeChecker.check(principal, "read", classRef(org)).granted) {
      return fail(403, "access denied");
    }
    const term = await requireTermOf(termId, org);
    if (!term.ok) return term.response;

    const students = await deps.directory.classRoster(classId);
    const latest = await deps.repo.latestForTerm(
      students.map((student) => student.studentId),
      termId,
    );
    return {
      status: 200,
      body: {
        students: students.map((student) => {
          const snapshot = latest.get(student.studentId);
          return {
            studentId: student.studentId,
            fullName: student.fullName,
            admissionNo: student.admissionNo,
            snapshotId: snapshot?.id ?? null,
            generatedAt: snapshot?.generatedAt.toISOString() ?? null,
          };
        }),
      },
    };
  };

  const preview: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const { studentId, termId } = ctx.request.body as { studentId: string; termId: string };

    const authorized = await authorizeStudent(principal, studentId);
    if (!authorized.ok) return authorized.response;
    const term = await requireTermOf(termId, authorized.org);
    if (!term.ok) return term.response;

    try {
      const snapshot = await deps.builder.build({
        studentId,
        termId,
        classId: authorized.org.classId,
        sectionId: authorized.org.sectionId ?? null,
      });
      // The preview returns the report card itself, without the stored
      // provenance block — that belongs to an issued snapshot.
      const { snapshotVersion: _version, provenance: _provenance, ...view } = snapshot;
      return {
        status: 200,
        body: view,
        // Nothing is persisted, but a pupil's full academic standing was
        // disclosed to this caller, and that is what ADR-0020 records.
        audit: {
          org: authorized.org,
          resourceId: studentId,
          details: { termId, classId: authorized.org.classId },
        },
      };
    } catch (caught) {
      if (caught instanceof ReportCardBuildError) return fail(caught.status, caught.message);
      throw caught;
    }
  };

  const generate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const { studentId, termId } = ctx.request.body as { studentId: string; termId: string };

    const authorized = await authorizeStudent(principal, studentId);
    if (!authorized.ok) return authorized.response;
    const term = await requireTermOf(termId, authorized.org);
    if (!term.ok) return term.response;

    try {
      const snapshot = await deps.builder.build({
        studentId,
        termId,
        classId: authorized.org.classId,
        sectionId: authorized.org.sectionId ?? null,
      });
      const row = await deps.repo.insert({
        studentId,
        termId,
        academicYear: term.term.academicYear,
        collegeId: authorized.org.collegeId,
        departmentId: authorized.org.departmentId,
        classId: authorized.org.classId,
        sectionId: authorized.org.sectionId ?? null,
        payload: snapshot,
        generatedBy: principal.id,
      });
      return {
        status: 201,
        body: { snapshotId: row.id, generatedAt: row.generatedAt.toISOString() },
        audit: {
          org: authorized.org,
          resourceId: studentId,
          details: {
            snapshotId: row.id,
            termId,
            classId: authorized.org.classId,
            // Recorded so an audit reader can tell whether a card was issued
            // over known-incomplete data without opening the snapshot.
            complete: snapshot.overall.complete && snapshot.attendance.complete,
            warnings: snapshot.warnings.length,
          },
        },
      };
    } catch (caught) {
      if (caught instanceof ReportCardBuildError) return fail(caught.status, caught.message);
      throw caught;
    }
  };

  const download: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const { snapshotId } = ctx.request.params as { snapshotId: string };

    const row = await deps.repo.get(snapshotId);
    if (row === null) return fail(404, "no such report card");

    // The org path recorded at issue time is the authority, re-checked against
    // the caller's CURRENT scope — so a later scope loss revokes access, and a
    // guessed snapshot id is refused before any bytes are produced.
    const org: OrgPath = {
      collegeId: row.collegeId,
      departmentId: row.departmentId,
      classId: row.classId,
      ...(row.sectionId === null ? {} : { sectionId: row.sectionId }),
    };
    if (!deps.scopeChecker.check(principal, "read", studentRef(org)).granted) {
      return fail(403, "access denied");
    }

    // Re-validated before rendering, by the version recorded ON THE ROW — so a
    // card issued under an earlier snapshot version keeps rendering after a
    // version bump. Only a version this build has no parser for fails, and it
    // fails loudly rather than rendering a half-populated document.
    const snapshot = parseStoredSnapshot(row.payload);
    if (snapshot === null) {
      return fail(
        409,
        "This report card was issued in a format this version cannot render. Generate a new snapshot.",
      );
    }

    return {
      status: 200,
      body: await renderReportCardPdf(snapshot, row.generatedAt),
      contentType: "application/pdf",
      audit: {
        org,
        resourceId: row.id,
        details: { studentId: row.studentId, termId: row.termId },
      },
    };
  };

  return {
    "reporting.school-report-card-roster": roster,
    "reporting.school-report-card-preview": preview,
    "reporting.school-report-card-generate": generate,
    "reporting.school-report-card-download": download,
  };
}
