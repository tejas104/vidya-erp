import type { AuditEvent, AuditLogger, Principal } from "@vidya/platform";
import type {
  AnalyticsReadModel,
  AtRiskReportEntry,
  NodeRollupsReport,
  RosterAttendanceReport,
  StudentPerformanceReport,
} from "@vidya/module-analytics";
import { randomUUID } from "node:crypto";
import type { ReportStore } from "../src/service/report-service";
import type { ReportsRepo } from "../src/repo/reports-repo";
import type { RptReportRow } from "../src/db/schema";

export class RecordingAudit implements AuditLogger {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  actions(): string[] {
    return this.events.map((event) => event.action);
  }
}

export class MemoryStore implements ReportStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
  }
  async get(key: string): Promise<Uint8Array> {
    const body = this.objects.get(key);
    if (body === undefined) {
      throw new Error(`no such object ${key}`);
    }
    return body;
  }
}

type StudentResult = StudentPerformanceReport | { state: "denied" } | { state: "not-found" };

/**
 * Scriptable stand-in for #5's read model. Reporting's job is to render
 * faithfully WHATEVER the (already scope-filtered) read model returns — so
 * these fakes let a test assert reporting adds nothing and hides nothing.
 * The real scope enforcement is proven in #5 and in the integration suite.
 */
export class FakeAnalyticsReadModel implements AnalyticsReadModel {
  student: StudentResult = { state: "not-found" };
  node: NodeRollupsReport | null = null;
  risk: AtRiskReportEntry[] | null = null;
  roster: RosterAttendanceReport | null = null;
  readonly calls: { method: string; principalId: string }[] = [];

  async studentPerformance(principal: Principal): Promise<StudentResult> {
    this.calls.push({ method: "studentPerformance", principalId: principal.id });
    return this.student;
  }
  async nodeRollups(principal: Principal): Promise<NodeRollupsReport | null> {
    this.calls.push({ method: "nodeRollups", principalId: principal.id });
    return this.node;
  }
  async atRisk(principal: Principal): Promise<AtRiskReportEntry[] | null> {
    this.calls.push({ method: "atRisk", principalId: principal.id });
    return this.risk;
  }
  async rosterAttendance(principal: Principal): Promise<RosterAttendanceReport | null> {
    this.calls.push({ method: "rosterAttendance", principalId: principal.id });
    return this.roster;
  }
}

export class InMemoryReportsRepo implements ReportsRepo {
  readonly rows = new Map<string, RptReportRow>();

  async create(input: Parameters<ReportsRepo["create"]>[0]): Promise<RptReportRow> {
    const row: RptReportRow = {
      id: `rpt_${randomUUID()}`,
      kind: input.kind,
      format: input.format,
      params: input.params,
      academicYear: input.academicYear,
      requesterPrincipal: input.requesterPrincipal,
      status: "pending",
      objectKey: null,
      rows: 0,
      error: null,
      requestedBy: input.requestedBy,
      createdAt: new Date(),
      finishedAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async get(id: string): Promise<RptReportRow | null> {
    return this.rows.get(id) ?? null;
  }

  async markRunning(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row !== undefined) this.rows.set(id, { ...row, status: "running" });
  }

  async finish(id: string, outcome: Parameters<ReportsRepo["finish"]>[1]): Promise<void> {
    const row = this.rows.get(id);
    if (row === undefined) return;
    this.rows.set(id, {
      ...row,
      ...(outcome.status === "completed"
        ? { status: "completed", objectKey: outcome.objectKey, rows: outcome.rows }
        : { status: "failed", error: outcome.error }),
      finishedAt: new Date(),
    });
  }

  async listByRequester(requestedBy: string, limit: number): Promise<RptReportRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.requestedBy === requestedBy)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

export function principal(id: string, overrides: Partial<Principal> = {}): Principal {
  return {
    id,
    kind: "user",
    displayName: id,
    roles: ["teacher"],
    scopes: [],
    grants: [],
    sessionId: "s",
    ...overrides,
  };
}
