import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db, Role, ScopeGrant } from "@vidya/platform";
import { rptReports, type RptReportRow } from "../db/schema";
import type { ReportParams } from "../report-data";

export type ReportFormat = "pdf" | "csv";
export type ReportStatus = "pending" | "running" | "completed" | "failed";

/** The minimal scope snapshot rehydrated into a Principal for generation. */
export interface RequesterSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly roles: Role[];
  readonly grants: ScopeGrant[];
}

export interface ReportsRepo {
  create(input: {
    kind: ReportParams["kind"];
    format: ReportFormat;
    params: ReportParams;
    academicYear: string;
    requestedBy: string;
    requesterPrincipal: RequesterSnapshot;
  }): Promise<RptReportRow>;
  get(id: string): Promise<RptReportRow | null>;
  markRunning(id: string): Promise<void>;
  finish(
    id: string,
    outcome:
      | { status: "completed"; objectKey: string; rows: number }
      | { status: "failed"; error: string },
  ): Promise<void>;
  listByRequester(requestedBy: string, limit: number): Promise<RptReportRow[]>;
}

export function createReportsRepo(db: Db): ReportsRepo {
  return {
    async create(input) {
      const rows = await db
        .insert(rptReports)
        .values({
          id: `rpt_${randomUUID()}`,
          kind: input.kind,
          format: input.format,
          params: input.params,
          academicYear: input.academicYear,
          requesterPrincipal: input.requesterPrincipal,
          requestedBy: input.requestedBy,
        })
        .returning();
      return rows[0]!;
    },

    async get(id) {
      const rows = await db.select().from(rptReports).where(eq(rptReports.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async markRunning(id) {
      await db.update(rptReports).set({ status: "running" }).where(eq(rptReports.id, id));
    },

    async finish(id, outcome) {
      await db
        .update(rptReports)
        .set(
          outcome.status === "completed"
            ? { status: "completed", objectKey: outcome.objectKey, rows: outcome.rows, finishedAt: new Date() }
            : { status: "failed", error: outcome.error, finishedAt: new Date() },
        )
        .where(eq(rptReports.id, id));
    },

    async listByRequester(requestedBy, limit) {
      return db
        .select()
        .from(rptReports)
        .where(eq(rptReports.requestedBy, requestedBy))
        .orderBy(desc(rptReports.createdAt))
        .limit(limit);
    },
  };
}
