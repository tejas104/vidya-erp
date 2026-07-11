/**
 * @vidya/module-analytics — PUBLIC API (the only importable surface).
 *
 * Role-scoped analytics derived from #4 (via its public read model — never
 * its tables): student performance views, at-risk surfacing, and org
 * rollups, all served under constituent-closure + the unconditional
 * minimum-cohort rule (ADR-0018, one page: src/aggregation-scope.ts).
 * Precomputation is blind (nightly worker job); disclosure happens only in
 * the serving layer.
 */

import { Counter } from "prom-client";
import {
  assertModuleWiring,
  type AuditLogger,
  type Db,
  type Metrics,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import type { AcademicsReadModel } from "@vidya/module-academics";
import type { PeopleDirectory } from "@vidya/module-people";
import { z } from "zod";
import {
  ROLLUP_JOB_NAME,
  analyticsModuleDefinition,
  rollupJobPayloadSchema,
} from "./definition";
import { createRollupsRepo } from "./repo/rollups-repo";
import { RollupBuilder } from "./service/rollup-builder";
import { QueryService } from "./service/query-service";
import { createAnalyticsReadModel, type AnalyticsReadModel } from "./service/read-model";
import { createAnalyticsHandlers } from "./api/handlers";
import { createRollupProcessor } from "./jobs/rollup-rebuild";

export {
  ROLLUP_JOB_NAME,
  ROLLUP_SCHEDULER_ID,
  MODULE_NAME as ANALYTICS_MODULE_NAME,
  academicYearForDate,
  analyticsModuleDefinition,
} from "./definition";
export {
  attendanceAggRef,
  canReadAttendanceAgg,
  canReadCrossSubjectAgg,
  canReadMarksAgg,
  cohortSufficient,
  marksAggRef,
} from "./aggregation-scope";
export type {
  AnalyticsReadModel,
  AtRiskReportEntry,
  NodeRollupsReport,
  RosterAttendanceReport,
  StudentPerformanceReport,
} from "./service/read-model";

export interface AnalyticsModuleDeps {
  readonly db: Db;
  readonly metrics: Metrics;
  readonly audit: AuditLogger;
  /** #2's chokepoint — every served aggregate goes through it (ADR-0018). */
  readonly scopeChecker: ScopeChecker;
  /** #4's read model — the ONLY source of academic records. */
  readonly academicsRead: AcademicsReadModel;
  readonly peopleDirectory: PeopleDirectory;
  readonly config: {
    readonly minCohort: number;
    readonly attendanceThreshold: number;
    readonly marksThreshold: number;
  };
  readonly enqueueRollup: (payload: z.infer<typeof rollupJobPayloadSchema>) => Promise<void>;
}

/**
 * The analytics public service: a scoped read model the reporting module
 * (#6) consumes so exports inherit the disclosure rules of ADR-0018.
 */
export interface AnalyticsService {
  readonly readModel: AnalyticsReadModel;
}

export function createAnalyticsModule(deps: AnalyticsModuleDeps): RuntimeModule<AnalyticsService> {
  const repo = createRollupsRepo(deps.db);
  const rebuildsTotal = new Counter({
    name: "vidya_analytics_rebuilds_total",
    help: "Rollup rebuild runs",
    registers: [deps.metrics.registry],
  });
  const builder = new RollupBuilder({
    academicsRead: deps.academicsRead,
    directory: deps.peopleDirectory,
    repo,
    audit: deps.audit,
    thresholds: {
      attendanceThreshold: deps.config.attendanceThreshold,
      marksThreshold: deps.config.marksThreshold,
    },
  });
  const query = new QueryService({
    repo,
    academicsRead: deps.academicsRead,
    directory: deps.peopleDirectory,
    scopeChecker: deps.scopeChecker,
    minCohort: deps.config.minCohort,
  });

  const rollupProcessor = createRollupProcessor(builder);
  const module: RuntimeModule<AnalyticsService> = {
    definition: analyticsModuleDefinition,
    handlers: createAnalyticsHandlers({
      query,
      directory: deps.peopleDirectory,
      enqueueRollup: deps.enqueueRollup,
    }),
    jobProcessors: {
      [ROLLUP_JOB_NAME]: async (payload, ctx) => {
        rebuildsTotal.inc();
        await rollupProcessor(payload, ctx);
      },
    },
    readinessChecks: [],
    service: {
      readModel: createAnalyticsReadModel(query, deps.peopleDirectory),
    },
  };
  assertModuleWiring(module);
  return module;
}
