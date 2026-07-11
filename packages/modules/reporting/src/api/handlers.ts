import type { Principal, RouteHandler } from "@vidya/platform";
import type { ReportService } from "../service/report-service";
import type { ReportParams } from "../report-data";
import type { ReportFormat } from "../repo/reports-repo";
import type { RptReportRow } from "../db/schema";
import type { reportJobPayloadSchema } from "../definition";
import type { z } from "zod";

export interface ReportingHandlerDeps {
  readonly service: ReportService;
  readonly enqueue: (payload: z.infer<typeof reportJobPayloadSchema>) => Promise<void>;
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

  return {
    "reporting.request": request,
    "reporting.list": list,
    "reporting.status": status,
    "reporting.download": download,
  };
}
