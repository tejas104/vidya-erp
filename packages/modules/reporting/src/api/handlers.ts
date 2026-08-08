import type {
  Principal,
  ResourceRef,
  RouteContext,
  RouteHandler,
  RouteResult,
  ScopeChecker,
} from "@vidya/platform";
import { usernameFromCode, type PeopleDirectory } from "@vidya/module-people";
import type { ReportService } from "../service/report-service";
import type { ReportParams, ReportData } from "../report-data";
import type { ReportFormat } from "../repo/reports-repo";
import type { RptReportRow } from "../db/schema";
import type { reportJobPayloadSchema } from "../definition";
import { renderCredentialSheet } from "../render/credential-sheet";
import type { z } from "zod";

/** Narrow seam onto identity's CredentialService.issueCredential (#11 B4). */
export interface CredentialIssuer {
  issueCredential(input: {
    personName: string;
    username: string;
    collegeId: string;
    roles: readonly ("student" | "teacher")[];
    createdBy: string;
  }): Promise<{ userId: string; username: string; temporaryPassword: string }>;
}

export interface ReportingHandlerDeps {
  readonly service: ReportService;
  readonly enqueue: (payload: z.infer<typeof reportJobPayloadSchema>) => Promise<void>;
  /** #11 B4: the synchronous per-class credential sheet's own dependencies —
   *  none of this touches ReportService/the queue above. */
  readonly scopeChecker: ScopeChecker;
  readonly peopleDirectory: PeopleDirectory;
  readonly linkStudentIdentity: (studentId: string, identityUserId: string) => Promise<boolean>;
  readonly identity: CredentialIssuer;
}

function denied(ctx: RouteContext, reason: string): RouteResult {
  ctx.logger.warn({ reason }, "scope check denied");
  return { status: 403, body: { message: "access denied" } };
}

function checkScope(
  scopeChecker: ScopeChecker,
  ctx: RouteContext,
  principal: Principal,
  action: Parameters<ScopeChecker["check"]>[1],
  resource: ResourceRef,
): { ok: true } | { ok: false; result: RouteResult } {
  const decision = scopeChecker.check(principal, action, resource);
  if (!decision.granted) {
    return { ok: false, result: denied(ctx, decision.reason) };
  }
  return { ok: true };
}

/** Academic year is purely cosmetic on this sheet's header — India's academic
 *  year rolls over in June, mirrored from apps/web's currentAcademicYear(). */
function currentAcademicYear(now = new Date()): string {
  const year = now.getFullYear();
  const startYear = now.getMonth() + 1 >= 6 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function reportView(row: RptReportRow) {
  return {
    id: row.id,
    kind: row.kind,
    format: row.format,
    academicYear: row.academicYear,
    status: row.status,
    rows: row.rows,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createReportingHandlers(deps: ReportingHandlerDeps): Record<string, RouteHandler> {
  const request: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      format: ReportFormat;
      academicYear: string;
      report: ReportParams;
    };
    const access = await deps.service.access(principal, body.report, body.academicYear);
    if (access === "not-found") {
      return { status: 404, body: { message: "no such report target" } };
    }
    if (access === "forbidden") {
      ctx.logger.warn({ kind: body.report.kind }, "report request denied: out of scope");
      return { status: 403, body: { message: "access denied" } };
    }
    const row = await deps.service.createRequest(principal, body.report, body.format, body.academicYear);
    await deps.enqueue({ reportId: row.id, source: "api" });
    return {
      status: 202,
      body: { reportId: row.id },
      audit: {
        resourceId: row.id,
        details: { kind: body.report.kind, format: body.format, params: body.report },
      },
    };
  };

  const list: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { limit: number };
    const rows = await deps.service.listMine(principal, query.limit);
    return { status: 200, body: { reports: rows.map(reportView) } };
  };

  const status: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { reportId: string };
    const row = await deps.service.getReport(params.reportId);
    if (row === null) {
      return { status: 404, body: { message: "not found" } };
    }
    if (row.requestedBy !== principal.id) {
      // Do not disclose existence to non-requesters.
      return { status: 403, body: { message: "access denied" } };
    }
    return { status: 200, body: reportView(row) };
  };

  const download: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { reportId: string };
    const result = await deps.service.download(principal, params.reportId);
    switch (result.state) {
      case "not-found":
        return { status: 404, body: { message: "not found" } };
      case "forbidden":
        ctx.logger.warn({ reportId: params.reportId }, "report download denied");
        return { status: 403, body: { message: "access denied" } };
      case "not-ready":
        return { status: 409, body: { message: "report is not ready yet" } };
      case "ok":
        return {
          status: 200,
          body: result.bytes,
          contentType: result.contentType,
          headers: {
            "content-disposition": `attachment; filename="${result.filename}"`,
            "cache-control": "no-store",
          },
        };
    }
  };

  /**
   * #11 B4 — the per-class "Generate credentials" action. Synchronous by
   * design ruling: builds the ReportData in memory from what this request
   * just issued and renders it straight into the response; nothing here
   * touches ReportService, the report queue, or object storage.
   */
  const classCredentials: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const classPath = await deps.peopleDirectory.classPath(params.classId);
    if (classPath === null) {
      return { status: 404, body: { message: "no such class" } };
    }
    // Admin's write authority is module-scoped (identity/people only — the
    // human-owned grant matrix in identity/src/core/scope-checker.ts), so
    // this resource is declared as a "people" write even though the route
    // itself lives in the reporting module's table.
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "people",
      resourceType: "class-credentials",
      org: classPath,
    });
    if (!scope.ok) {
      return scope.result;
    }

    const roster = await deps.peopleDirectory.classRoster(params.classId);
    const missing = roster.filter((student) => student.identityUserId === null);

    const rows: (string | number)[][] = [];
    let issuedCount = 0;
    for (const student of missing) {
      try {
        const issued = await deps.identity.issueCredential({
          personName: student.fullName,
          username: usernameFromCode(student.admissionNo),
          collegeId: classPath.collegeId,
          roles: ["student"],
          createdBy: principal.id,
        });
        const linked = await deps.linkStudentIdentity(student.studentId, issued.userId);
        if (!linked) {
          ctx.logger.warn(
            { studentId: student.studentId, identityUserId: issued.userId },
            "class-credentials: identity issued but linking to student failed — skipping row so no orphaned account is printed",
          );
          continue;
        }
        rows.push([student.admissionNo, student.fullName, issued.username, issued.temporaryPassword]);
        issuedCount += 1;
      } catch (error) {
        ctx.logger.warn(
          { studentId: student.studentId, err: error },
          "class-credentials: issuance failed for one student — skipped, rest of the class continues",
        );
      }
    }

    const className = (await deps.peopleDirectory.namesFor([params.classId])).get(params.classId) ?? params.classId;
    const data: ReportData = {
      kind: "class-credentials",
      title: "Class credential sheet",
      subtitle: className,
      academicYear: currentAcademicYear(),
      generatedFor: principal.displayName ?? principal.id,
      generatedAt: new Date().toISOString(),
      stats: [{ label: "Accounts issued", value: String(issuedCount) }],
      tables: [
        {
          caption: className,
          columns: ["Roll no", "Name", "Username", "Temporary password"],
          rows,
        },
      ],
      notes: [
        "Contains plaintext temporary passwords — hand each row's slip to its student and discard this sheet promptly.",
      ],
      rowCount: rows.length,
    };
    const bytes = new Uint8Array(await renderCredentialSheet(data));

    return {
      status: 200,
      body: bytes,
      contentType: "application/pdf",
      headers: {
        "content-disposition": `attachment; filename="class-credentials-${params.classId}.pdf"`,
        "cache-control": "no-store",
      },
      audit: {
        resourceId: params.classId,
        details: { collegeId: classPath.collegeId, issuedCount, rosterSize: roster.length },
      },
    };
  };

  return {
    "reporting.request": request,
    "reporting.list": list,
    "reporting.status": status,
    "reporting.download": download,
    "reporting.class-credentials": classCredentials,
  };
}
