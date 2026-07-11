import type { AuditLogger, Logger, Principal } from "@vidya/platform";
import type { AnalyticsReadModel } from "@vidya/module-analytics";
import { renderCsv } from "../render/csv";
import { renderPdf } from "../render/pdf";
import {
  canProduce,
  collectReport,
  type ReportParams,
} from "../report-data";
import type { ReportFormat, ReportsRepo, RequesterSnapshot } from "../repo/reports-repo";
import type { RptReportRow } from "../db/schema";

/** Object-storage port; the module factory adapts the platform S3 client. */
export interface ReportStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export interface ReportServiceDeps {
  readonly repo: ReportsRepo;
  readonly readModel: AnalyticsReadModel;
  readonly store: ReportStore;
  readonly audit: AuditLogger;
  readonly onFinished?: (kind: string, format: string, status: "completed" | "failed") => void;
}

const CONTENT_TYPE: Record<ReportFormat, string> = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
};

/** Rebuilds a Principal from the stored scope snapshot (generation-time scope). */
function rehydrate(snapshot: RequesterSnapshot): Principal {
  return {
    id: snapshot.id,
    kind: "user",
    displayName: snapshot.displayName,
    roles: snapshot.roles,
    scopes: [],
    grants: snapshot.grants,
    sessionId: null,
  };
}

export type DownloadResult =
  | { readonly state: "ok"; readonly bytes: Uint8Array; readonly contentType: string; readonly filename: string }
  | { readonly state: "not-found" }
  | { readonly state: "forbidden" }
  | { readonly state: "not-ready" };

export class ReportService {
  constructor(private readonly deps: ReportServiceDeps) {}

  /** Access decision reused at request time and on download (no rendering). */
  access(principal: Principal, params: ReportParams, academicYear: string) {
    return canProduce(this.deps.readModel, principal, params, academicYear);
  }

  /** Records the request (scope already checked by the handler) and returns the row. */
  async createRequest(
    principal: Principal,
    params: ReportParams,
    format: ReportFormat,
    academicYear: string,
  ): Promise<RptReportRow> {
    return this.deps.repo.create({
      kind: params.kind,
      format,
      params,
      academicYear,
      requestedBy: principal.id,
      requesterPrincipal: {
        id: principal.id,
        displayName: principal.displayName ?? principal.id,
        roles: [...principal.roles],
        grants: [...principal.grants],
      },
    });
  }

  getReport(id: string): Promise<RptReportRow | null> {
    return this.deps.repo.get(id);
  }

  listMine(principal: Principal, limit: number): Promise<RptReportRow[]> {
    return this.deps.repo.listByRequester(principal.id, limit);
  }

  /** Worker side: generate with the REQUESTER's stored scope, upload, audit. */
  async run(reportId: string, log: Logger): Promise<void> {
    const row = await this.deps.repo.get(reportId);
    if (row === null) {
      log.warn({ reportId }, "report job for unknown id — skipping");
      return;
    }
    if (row.status === "completed") {
      return;
    }
    await this.deps.repo.markRunning(reportId);
    const snapshot = row.requesterPrincipal as RequesterSnapshot;
    const principal = rehydrate(snapshot);
    const params = row.params as ReportParams;
    const format = row.format as ReportFormat;
    try {
      const data = await collectReport(
        this.deps.readModel,
        principal,
        params,
        row.academicYear,
        snapshot.displayName,
      );
      if (data === null) {
        // Scope changed between request and generation → fail closed.
        await this.deps.repo.finish(reportId, { status: "failed", error: "no in-scope content at generation time" });
        this.deps.onFinished?.(row.kind, format, "failed");
        return;
      }
      const bytes =
        format === "csv" ? new TextEncoder().encode(renderCsv(data)) : new Uint8Array(await renderPdf(data));
      const objectKey = `reports/${reportId}.${format}`;
      await this.deps.store.put(objectKey, bytes, CONTENT_TYPE[format]);
      await this.deps.repo.finish(reportId, { status: "completed", objectKey, rows: data.rowCount });
      await this.deps.audit.record({
        module: "reporting",
        action: "reporting.report-generated",
        actorType: "user",
        actorId: row.requestedBy,
        resourceType: "report",
        resourceId: reportId,
        requestId: null,
        details: { kind: row.kind, format, params, rows: data.rowCount, academicYear: row.academicYear },
      });
      this.deps.onFinished?.(row.kind, format, "completed");
      log.info({ reportId, kind: row.kind, rows: data.rowCount }, "report generated");
    } catch (error) {
      await this.deps.repo.finish(reportId, {
        status: "failed",
        error: error instanceof Error ? error.message : "generation failed",
      });
      this.deps.onFinished?.(row.kind, format, "failed");
      throw error;
    }
  }

  /**
   * Scoped download (ADR-0020). The object key is never the access boundary:
   * the report is downloadable only by its requester AND only while their
   * CURRENT scope still covers it — an out-of-scope caller (URL guess) or a
   * requester whose scope was revoked gets 403 before any bytes are read.
   */
  async download(currentPrincipal: Principal, reportId: string): Promise<DownloadResult> {
    const row = await this.deps.repo.get(reportId);
    if (row === null) {
      return { state: "not-found" };
    }
    if (row.requestedBy !== currentPrincipal.id) {
      return { state: "forbidden" };
    }
    if (row.status !== "completed" || row.objectKey === null) {
      return { state: "not-ready" };
    }
    const access = await this.access(currentPrincipal, row.params as ReportParams, row.academicYear);
    if (access !== "ok") {
      return { state: "forbidden" };
    }
    await this.deps.audit.record({
      module: "reporting",
      action: "reporting.report-downloaded",
      actorType: currentPrincipal.kind,
      actorId: currentPrincipal.id,
      resourceType: "report",
      resourceId: reportId,
      requestId: null,
      details: { kind: row.kind, format: row.format },
    });
    const bytes = await this.deps.store.get(row.objectKey);
    return {
      state: "ok",
      bytes,
      contentType: CONTENT_TYPE[row.format as ReportFormat],
      filename: `${row.kind}-${reportId}.${row.format}`,
    };
  }
}
