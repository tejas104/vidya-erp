import type { PeopleDirectory } from "@vidya/module-people";
import type { OrgPath, Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import { renderCertificatePdf } from "./certificate-pdf";
import { parseStoredCertificateSnapshot } from "./certificate-contract";
import { CertificateIssueConflict, CertificateIssueDenied, CertificateSourceUnavailable,
  type CertificateRepo } from "./certificate-repo";

export interface CertificateHandlerDeps {
  readonly edition: "school" | "college";
  readonly repo: CertificateRepo;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
}

function leader(principal: Principal): Principal {
  return { ...principal,
    roles: principal.roles.filter((role) => role === "admin" || role === "principal"),
    grants: principal.grants.filter((grant) => grant.role === "admin" || grant.role === "principal") };
}

function canRead(deps: CertificateHandlerDeps, principal: Principal, org: OrgPath): boolean {
  return deps.scopeChecker.check(leader(principal), "read", {
    module: "reporting", resourceType: "student", org,
  }).granted;
}

const fail = (status: number, message: string) => ({ status, body: { message } });

export function createSchoolCertificateHandlers(deps: CertificateHandlerDeps): Record<string, RouteHandler> {
  const issue: RouteHandler = async (ctx) => {
    if (deps.edition !== "school") return fail(404, "not available");
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { studentId: string; enrollmentId: string;
      kind: "bonafide" | "transfer"; correctionOfId?: string; idempotencyKey: string };
    // The owner requires admin + principal exit approval and configurable fee
    // clearance before TC issuance. Keep this path closed until both checks
    // are persisted and evaluated in the same transaction as issuance.
    if (body.kind === "transfer") return fail(409, "Transfer certificates require the exit approval and fee-clearance workflow.");
    const issuedBy = principal.roles.includes("admin") ? "admin" : "principal";
    try {
      const { row, receipt, replay } = await deps.repo.issue({ ...body,
        correctionOfId: body.correctionOfId ?? null, issuedBy, actorId: principal.id,
        auditRequestId: ctx.requestId,
        authorize: (org) => canRead(deps, principal, org),
      });
      return { status: replay ? 200 : 201,
        body: { certificateId: row.id, number: row.number, issuedAt: row.issuedAt.toISOString(), replay },
        audit: { org: { collegeId: row.collegeId, departmentId: row.departmentId,
          classId: row.classId, sectionId: row.sectionId }, resourceId: row.id,
          details: { kind: row.kind, number: row.number, replay },
          persisted: receipt === null
            ? { kind: "idempotent-replay" as const, resourceId: row.id }
            : { kind: "in-transaction" as const, receipt } },
      };
    } catch (error) {
      if (error instanceof CertificateIssueDenied) return fail(403, "access denied");
      if (error instanceof CertificateSourceUnavailable) return fail(404, "pupil or verified enrollment unavailable");
      if (error instanceof CertificateIssueConflict) return fail(409, error.message);
      throw error;
    }
  };

  const list: RouteHandler = async (ctx) => {
    if (deps.edition !== "school") return fail(404, "not available");
    const principal = ctx.principal as Principal;
    const { studentId } = ctx.request.params as { studentId: string };
    const position = await deps.directory.studentPosition(studentId);
    if (position === null) return fail(404, "no such pupil");
    if (!canRead(deps, principal, position)) return fail(403, "access denied");
    const rows = await deps.repo.list(studentId);
    const visible = rows.filter((row) => canRead(deps, principal, { collegeId: row.collegeId,
      departmentId: row.departmentId, classId: row.classId, sectionId: row.sectionId }));
    return { status: 200, body: { certificates: visible.map((row) => ({
      certificateId: row.id, number: row.number, kind: row.kind,
      issuedAt: row.issuedAt.toISOString(), correctionOfId: row.correctionOfId,
    })) }, audit: { org: position, resourceId: studentId, details: { count: visible.length } } };
  };

  const download: RouteHandler = async (ctx) => {
    if (deps.edition !== "school") return fail(404, "not available");
    const principal = ctx.principal as Principal;
    const { certificateId } = ctx.request.params as { certificateId: string };
    const row = await deps.repo.get(certificateId);
    if (row === null) return fail(404, "no such certificate");
    const org: OrgPath = { collegeId: row.collegeId, departmentId: row.departmentId,
      classId: row.classId, sectionId: row.sectionId };
    if (!canRead(deps, principal, org)) return fail(403, "access denied");
    const snapshot = parseStoredCertificateSnapshot(row.payload);
    if (snapshot === null) return fail(409, "This certificate version cannot be rendered by this build.");
    return { status: 200, body: await renderCertificatePdf(snapshot), contentType: "application/pdf",
      headers: { "content-disposition": `attachment; filename="${row.number.replace(/[^A-Za-z0-9.-]/g, "-")}.pdf"`,
        "x-content-type-options": "nosniff", "cache-control": "no-store" },
      audit: { org, resourceId: row.id, details: { studentId: row.studentId, number: row.number } } };
  };

  return {
    "reporting.school-certificate-issue": issue,
    "reporting.school-certificates-for-student": list,
    "reporting.school-certificate-download": download,
  };
}
