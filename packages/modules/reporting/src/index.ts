/**
 * @vidya/module-reporting — PUBLIC API (the only importable surface).
 *
 * Scope-filtered PDF/CSV reports built through #5's AnalyticsReadModel (and
 * #4's read model), so a report inherits constituent-closure, the
 * minimum-cohort rule and at-risk field-gating — a report is a disclosure
 * surface, no exemption because it is "a document" (ADR-0020). CSV cells are
 * formula-injection-escaped (escape-csv.ts); downloads are scope-checked
 * (never URL-secret). Generation runs in the worker.
 */

import { Counter } from "prom-client";
import {
  assertModuleWiring,
  ensureBucket,
  getObjectBytes,
  putObjectBytes,
  type AuditLogger,
  type Db,
  type Metrics,
  type ObjectStorageClient,
  type RuntimeModule,
} from "@vidya/platform";
import type { AnalyticsReadModel } from "@vidya/module-analytics";
import { z } from "zod";
import { REPORT_JOB_NAME, reportJobPayloadSchema, reportingModuleDefinition } from "./definition";
import type { ReportSources } from "./report-data";
import { createReportsRepo } from "./repo/reports-repo";
import { ReportService } from "./service/report-service";
import { createReportingHandlers } from "./api/handlers";
import { createReportProcessor } from "./jobs/report-generate";

export {
  REPORT_JOB_NAME,
  MODULE_NAME as REPORTING_MODULE_NAME,
  reportingModuleDefinition,
} from "./definition";
export {
  csvDocument,
  csvRow,
  escapeCsvCell,
  isFormulaInjection,
} from "./escape-csv";
export type { ReportSources } from "./report-data";

export interface ReportingModuleDeps {
  readonly db: Db;
  readonly metrics: Metrics;
  readonly audit: AuditLogger;
  /** #5's scoped read model — the source of analytics report content. */
  readonly analyticsRead: AnalyticsReadModel;
  /** Injected non-analytics sources (results grade-card); absent kinds fail closed. */
  readonly sources?: ReportSources;
  readonly storage: { readonly client: ObjectStorageClient; readonly bucket: string };
  readonly enqueueReport: (payload: z.infer<typeof reportJobPayloadSchema>) => Promise<void>;
}

export type ReportingService = Record<string, never>;

export function createReportingModule(deps: ReportingModuleDeps): RuntimeModule<ReportingService> {
  const repo = createReportsRepo(deps.db);
  const reportsTotal = new Counter({
    name: "vidya_reports_total",
    help: "Report generation by kind, format and outcome",
    labelNames: ["kind", "format", "status"],
    registers: [deps.metrics.registry],
  });

  let bucketReady = false;
  const ensureReady = async (): Promise<void> => {
    if (!bucketReady) {
      await ensureBucket(deps.storage.client, deps.storage.bucket);
      bucketReady = true;
    }
  };

  const service = new ReportService({
    repo,
    readModel: deps.analyticsRead,
    ...(deps.sources !== undefined ? { sources: deps.sources } : {}),
    store: {
      put: async (key, body, contentType) => {
        await ensureReady();
        await putObjectBytes(deps.storage.client, deps.storage.bucket, key, body, contentType);
      },
      get: (key) => getObjectBytes(deps.storage.client, deps.storage.bucket, key),
    },
    audit: deps.audit,
    onFinished: (kind, format, status) => reportsTotal.inc({ kind, format, status }),
  });

  const module: RuntimeModule<ReportingService> = {
    definition: reportingModuleDefinition,
    handlers: createReportingHandlers({ service, enqueue: deps.enqueueReport }),
    jobProcessors: {
      [REPORT_JOB_NAME]: createReportProcessor(service),
    },
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
