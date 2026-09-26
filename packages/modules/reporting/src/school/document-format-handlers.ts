import { randomUUID } from "node:crypto";
import type { PeopleDirectory } from "@vidya/module-people";
import type { Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import { DEFAULT_DOCUMENT_STYLE, decodeSample, documentStyleSchema, type DocumentFamily } from "./document-format";
import { DocumentFormatConflictError, type DocumentFormatRepo } from "./document-format-repo";

export interface DocumentFormatHandlerDeps {
  readonly edition: "school" | "college";
  readonly repo: DocumentFormatRepo;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
  readonly store: { put(key: string, bytes: Uint8Array, contentType: string): Promise<void>; get(key: string): Promise<Uint8Array> };
}

export function createSchoolDocumentFormatHandlers(deps: DocumentFormatHandlerDeps): Record<string, RouteHandler> {
  async function authorize(principal: Principal, collegeId: string) {
    if (deps.edition !== "school") return 404;
    const administrator = { ...principal, roles: principal.roles.filter((role) => role === "admin"),
      grants: principal.grants.filter((grant) => grant.role === "admin") };
    if (!deps.scopeChecker.check(administrator, "read", {
      module: "reporting", resourceType: "college", org: { collegeId },
    }).granted) return 403;
    return await deps.directory.collegeExists(collegeId) ? 200 : 404;
  }
  const get: RouteHandler = async (ctx) => {
    const { collegeId, family } = ctx.request.params as { collegeId: string; family: DocumentFamily };
    const status = await authorize(ctx.principal as Principal, collegeId);
    if (status !== 200) return { status, body: { message: status === 404 ? "school not found" : "access denied" } };
    const row = await deps.repo.latest(collegeId, family);
    return { status: 200, body: {
      family, version: row?.version ?? 0, style: row?.style ?? DEFAULT_DOCUMENT_STYLE,
      sample: row?.sampleKey ? { filename: row.sampleFilename, contentType: row.sampleContentType } : null,
    } };
  };
  const save: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const { collegeId, family } = ctx.request.params as { collegeId: string; family: DocumentFamily };
    const status = await authorize(principal, collegeId);
    if (status !== 200) return { status, body: { message: status === 404 ? "school not found" : "access denied" } };
    const body = ctx.request.body as { expectedVersion: number; style: unknown; sample?: { filename: string; contentType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; dataBase64: string } };
    const style = documentStyleSchema.parse(body.style);
    const bytes = body.sample ? decodeSample(body.sample) : null;
    if (body.sample && !bytes) return { status: 422, body: { message: "The sample must have a PDF or DOCX file signature and be at most 1 MB." } };
    // The sample is reference material only. Its random private key is never a
    // download capability; every download rechecks the school grant.
    const sample = body.sample && bytes ? {
      key: `school-formats/${collegeId}/${family}/${randomUUID()}`,
      filename: body.sample.filename, contentType: body.sample.contentType,
    } : null;
    if (sample && bytes) await deps.store.put(sample.key, bytes, sample.contentType);
    try {
      const { row, receipt } = await deps.repo.append({ collegeId, family, expectedVersion: body.expectedVersion,
        style, sample, actorId: principal.id, requestId: ctx.requestId });
      return { status: 200, body: { family, version: row.version, style: row.style,
        sample: row.sampleKey ? { filename: row.sampleFilename, contentType: row.sampleContentType } : null },
        audit: { org: { collegeId }, resourceId: collegeId, persisted: { kind: "in-transaction", receipt } } };
    } catch (error) {
      if (error instanceof DocumentFormatConflictError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };
  const downloadSample: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const { collegeId, family } = ctx.request.params as { collegeId: string; family: DocumentFamily };
    const status = await authorize(principal, collegeId);
    if (status !== 200) return { status, body: { message: status === 404 ? "school not found" : "access denied" } };
    const row = await deps.repo.latest(collegeId, family);
    if (!row?.sampleKey || !row.sampleContentType) return { status: 404, body: { message: "no sample uploaded" } };
    return { status: 200, body: await deps.store.get(row.sampleKey), contentType: row.sampleContentType,
      headers: { "content-disposition": `attachment; filename="${(row.sampleFilename ?? "sample").replace(/[^\w. -]/g, "_")}"`,
        "x-content-type-options": "nosniff", "cache-control": "no-store" },
      audit: { org: { collegeId }, resourceId: collegeId, details: { family, version: row.version } } };
  };
  return {
    "reporting.school-document-format-get": get,
    "reporting.school-document-format-save": save,
    "reporting.school-document-format-sample": downloadSample,
  };
}
