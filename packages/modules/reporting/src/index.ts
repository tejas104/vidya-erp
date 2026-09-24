/**
 * @vidya/module-reporting — PUBLIC API (the only importable surface).
 *
 * Scope-filtered PDF/CSV reports built through #5's AnalyticsReadModel (and
 * #4's read model), so a report inherits constituent-closure, the
 * minimum-cohort rule and at-risk field-gating — a report is a disclosure
 * surface, no exemption because it is "a document" (ADR-0020). CSV cells are
 * formula-injection-escaped (@vidya/platform's csv/escape-csv.ts, shared with
 * people's import-template endpoint); downloads are scope-checked (never
 * URL-secret). Generation runs in the worker.
 */

import { Counter } from "prom-client";
import {
  assertModuleWiring,
  csvDocument,
  csvRow,
  ensureBucket,
  escapeCsvCell,
  getObjectBytes,
  isFormulaInjection,
  putObjectBytes,
  type AuditLogger,
  type Db,
  type Metrics,
  type ObjectStorageClient,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import type { AnalyticsReadModel } from "@vidya/module-analytics";
import type { AcademicsReadModel } from "@vidya/module-academics";
import type { SchoolAcademicsReadModel } from "@vidya/module-school-academics";
import type { PeopleDirectory, PeopleModuleService } from "@vidya/module-people";
import { z } from "zod";
import { REPORT_JOB_NAME, reportJobPayloadSchema, reportingModuleDefinition } from "./definition";
import type { ReportSources } from "./report-data";
import { createReportsRepo } from "./repo/reports-repo";
import { ReportService } from "./service/report-service";
import { createReportingHandlers, type CredentialIssuer } from "./api/handlers";
import { createReportProcessor } from "./jobs/report-generate";
import { createReportCardRepo } from "./school/report-card-repo";
import { ReportCardBuilder } from "./school/report-card-service";
import { createSchoolReportCardHandlers } from "./school/report-card-handlers";

export {
  REPORT_JOB_NAME,
  MODULE_NAME as REPORTING_MODULE_NAME,
  reportingModuleDefinition,
} from "./definition";
// Re-exported for backward compatibility — the CSV formula-injection escaper
// moved to @vidya/platform (packages/platform/src/csv/escape-csv.ts) so
// packages/modules/people can reuse it without a people <- reporting <-
// {academics,analytics,exams,results} <- people import cycle.
export { csvDocument, csvRow, escapeCsvCell, isFormulaInjection };
export type { ReportSources } from "./report-data";
export { SNAPSHOT_VERSION as SCHOOL_REPORT_CARD_SNAPSHOT_VERSION } from "./school/report-card-contract";
export type { ReportCardPreview, ReportCardSnapshot } from "./school/report-card-contract";

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
  /** #11 B4's synchronous per-class credential sheet — its own dependencies,
   *  wired independently of the queued report flow above. */
  readonly scopeChecker: ScopeChecker;
  readonly peopleDirectory: PeopleDirectory;
  readonly guardianAccess: PeopleModuleService["guardianAccess"];
  readonly linkStudentIdentity: (studentId: string, identityUserId: string) => Promise<boolean>;
  readonly identity: CredentialIssuer;
  /** School report cards: the two calculation engines' read models, reached
   *  through their owning modules' public APIs. Report cards are built by
   *  composing them — never by querying `sca_`/`acd_` tables from here. */
  readonly schoolAcademicsRead: SchoolAcademicsReadModel;
  readonly academicsRead: AcademicsReadModel;
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
    handlers: {
      ...createReportingHandlers({
        service,
        enqueue: deps.enqueueReport,
        scopeChecker: deps.scopeChecker,
        peopleDirectory: deps.peopleDirectory,
        linkStudentIdentity: deps.linkStudentIdentity,
        identity: deps.identity,
      }),
      ...createSchoolReportCardHandlers({
        builder: new ReportCardBuilder({
          schoolAcademics: deps.schoolAcademicsRead,
          academics: deps.academicsRead,
          directory: deps.peopleDirectory,
        }),
        repo: createReportCardRepo(deps.db),
        schoolAcademics: deps.schoolAcademicsRead,
        directory: deps.peopleDirectory,
        scopeChecker: deps.scopeChecker,
        guardianAccess: deps.guardianAccess,
      }),
    },
    jobProcessors: {
      [REPORT_JOB_NAME]: createReportProcessor(service),
    },
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
