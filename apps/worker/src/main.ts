import {
  Lifecycle,
  assertModuleWiring,
  createDb,
  createLogger,
  createMetrics,
  createModuleQueue,
  createModuleWorker,
  createObjectStorage,
  createRedis,
  loadConfig,
  pingPostgres,
  pingRedis,
  upsertRepeatableJob,
  type OrgDirectory,
  type RegisteredJob,
  type RuntimeModule,
} from "@vidya/platform";
import {
  HEARTBEAT_JOB_NAME,
  HEARTBEAT_SCHEDULER_ID,
  SYSTEM_MODULE_NAME,
  createSystemModule,
} from "@vidya/module-system";
import {
  IDENTITY_MODULE_NAME,
  RESET_CLEANUP_JOB_NAME,
  RESET_CLEANUP_SCHEDULER_ID,
  createIdentityCore,
  createIdentityModule,
} from "@vidya/module-identity";
import {
  IMPORT_JOB_NAME,
  PEOPLE_MODULE_NAME,
  RECONCILE_JOB_NAME,
  RECONCILE_SCHEDULER_ID,
  createPeopleModule,
} from "@vidya/module-people";
import {
  ACADEMICS_MODULE_NAME,
  GAP_SCAN_JOB_NAME,
  GAP_SCAN_SCHEDULER_ID,
  createAcademicsModule,
} from "@vidya/module-academics";
import {
  ANALYTICS_MODULE_NAME,
  ROLLUP_JOB_NAME,
  ROLLUP_SCHEDULER_ID,
  createAnalyticsModule,
} from "@vidya/module-analytics";
import {
  REPORTING_MODULE_NAME,
  REPORT_JOB_NAME,
  createReportingModule,
} from "@vidya/module-reporting";
import { createPortalModule } from "@vidya/module-portal";
import { createTimetableModule } from "@vidya/module-timetable";
import { createCourseworkModule } from "@vidya/module-coursework";
import { createMetricsServer } from "./metrics-server";

const RESET_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
const GAP_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * COMPOSITION ROOT — worker process.
 *
 * Shares module code with the web replica but runs a different slice of the
 * module contract: job processors instead of route handlers. Stateless
 * (Constitution rules 9–10): any number of worker replicas may run; BullMQ
 * coordinates job ownership through Redis.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    level: config.logLevel,
    serviceName: "vidya-worker",
    serviceVersion: config.serviceVersion,
  });
  const metrics = createMetrics({ serviceName: "vidya-worker" });
  const lifecycle = new Lifecycle({
    logger,
    // Workers do not sit behind a load balancer; no drain delay is needed —
    // close() already waits for in-flight jobs.
    drainMs: 0,
    timeoutMs: config.lifecycle.timeoutMs,
  });

  const { pool, db } = createDb({
    url: config.database.url,
    poolMax: config.database.poolMax,
    logger,
    applicationName: "vidya-worker",
  });
  const redis = createRedis({
    url: config.redis.url,
    logger,
    connectionName: "vidya-worker",
  });
  lifecycle.onShutdown("postgres-pool", () => pool.end());
  lifecycle.onShutdown("redis", async () => {
    redis.disconnect();
  });

  const system = createSystemModule({
    db,
    metrics,
    serviceVersion: config.serviceVersion,
    isDraining: () => lifecycle.isDraining,
    infrastructureChecks: [
      { name: "postgres", check: () => pingPostgres(pool) },
      { name: "redis", check: () => pingRedis(redis) },
    ],
  });

  const identityCore = createIdentityCore({
    redis,
    session: {
      ttlHours: config.identity.session.ttlHours,
      idleMinutes: config.identity.session.idleMinutes,
    },
  });
  // Late-bound OrgDirectory: interface-only dependency keeps the package
  // graph acyclic; target set once the people module exists.
  const orgDirectoryRef: { current: OrgDirectory | null } = { current: null };
  const identity = createIdentityModule({
    db,
    redis,
    metrics,
    audit: system.service.audit,
    core: identityCore,
    config: config.identity,
    orgDirectory: () => orgDirectoryRef.current,
  });

  const objectStorage = createObjectStorage(config.s3);
  lifecycle.onShutdown("object-storage", async () => {
    objectStorage.destroy();
  });
  const peopleQueue = createModuleQueue({
    module: PEOPLE_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("people-queue", () => peopleQueue.close());
  const people = createPeopleModule({
    db,
    metrics,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    identityGrants: identity.service.derivedGrants,
    storage: { client: objectStorage, bucket: config.s3.bucket },
    enqueueImport: async (payload) => {
      await peopleQueue.queue.add(IMPORT_JOB_NAME, payload);
    },
  });
  orgDirectoryRef.current = people.service.orgDirectory;

  const academics = createAcademicsModule({
    db,
    metrics,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
    readAudit: async (resourceType, resourceId, limit) =>
      (await system.service.readAuditEventsForResource(resourceType, resourceId, limit)).map(
        (row) => ({
          action: row.action,
          actorId: row.actorId,
          occurredAt: row.occurredAt,
          details: row.details,
        }),
      ),
  });

  const analyticsQueue = createModuleQueue({
    module: ANALYTICS_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("analytics-queue", () => analyticsQueue.close());
  const analytics = createAnalyticsModule({
    db,
    metrics,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    academicsRead: academics.service.readModel,
    peopleDirectory: people.service.directory,
    config: config.analytics,
    enqueueRollup: async (payload) => {
      await analyticsQueue.queue.add(ROLLUP_JOB_NAME, payload);
    },
  });

  const reportingQueue = createModuleQueue({
    module: REPORTING_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("reporting-queue", () => reportingQueue.close());
  const reporting = createReportingModule({
    db,
    metrics,
    audit: system.service.audit,
    analyticsRead: analytics.service.readModel,
    storage: { client: objectStorage, bucket: config.s3.bucket },
    enqueueReport: async (payload) => {
      await reportingQueue.queue.add(REPORT_JOB_NAME, payload);
    },
  });

  // Portal (W1): no jobs — included so the module inventory stays uniform
  // across processes (registry ↔ composition parity checks).
  // --- timetable ---
  const timetable = createTimetableModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
  });

  // --- coursework ---
  const coursework = createCourseworkModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
    storage: { client: objectStorage, bucket: config.s3.bucket },
  });

  const portal = createPortalModule({
    peopleDirectory: people.service.directory,
    academicsRead: academics.service.readModel,
    timetableRead: timetable.service.readModel,
  });

  const modules: RuntimeModule<unknown>[] = [
    system,
    identity,
    people,
    academics,
    analytics,
    reporting,
    timetable,
    coursework,
    portal,
  ];

  for (const module of modules) {
    assertModuleWiring(module);
    if (module.definition.jobs.length === 0) {
      continue;
    }
    const jobs: RegisteredJob[] = module.definition.jobs.map((spec) => {
      const processor = module.jobProcessors[spec.name];
      if (processor === undefined) {
        throw new Error(
          `module "${module.definition.name}" is missing processor "${spec.name}"`,
        );
      }
      return { spec, processor };
    });
    const workerHandle = createModuleWorker({
      module: module.definition.name,
      redisUrl: config.redis.url,
      logger,
      metrics,
      jobs,
    });
    lifecycle.onShutdown(`bullmq-worker-${module.definition.name}`, () => workerHandle.close());
    logger.info(
      { module: module.definition.name, jobs: jobs.map((job) => job.spec.name) },
      "job processors registered",
    );
  }

  // The reference repeatable schedule: a real heartbeat through the full
  // enqueue → Redis → worker → audit-table path. upsert is idempotent across
  // replicas — many workers, one schedule.
  const systemQueue = createModuleQueue({
    module: SYSTEM_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("system-queue", () => systemQueue.close());
  await upsertRepeatableJob({
    queue: systemQueue.queue,
    schedulerId: HEARTBEAT_SCHEDULER_ID,
    everyMs: config.worker.systemHeartbeatIntervalMs,
    jobName: HEARTBEAT_JOB_NAME,
    payload: { source: "worker-schedule" },
  });

  const identityQueue = createModuleQueue({
    module: IDENTITY_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("identity-queue", () => identityQueue.close());
  await upsertRepeatableJob({
    queue: identityQueue.queue,
    schedulerId: RESET_CLEANUP_SCHEDULER_ID,
    everyMs: RESET_CLEANUP_INTERVAL_MS,
    jobName: RESET_CLEANUP_JOB_NAME,
    payload: { source: "worker-schedule" },
  });

  // The ADR-0015 safety net: hourly derived-grant reconciliation.
  await upsertRepeatableJob({
    queue: peopleQueue.queue,
    schedulerId: RECONCILE_SCHEDULER_ID,
    everyMs: RECONCILE_INTERVAL_MS,
    jobName: RECONCILE_JOB_NAME,
    payload: { source: "worker-schedule" },
  });

  // Daily attendance gap scan (#4): sections with no session for the day.
  const academicsQueue = createModuleQueue({
    module: ACADEMICS_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("academics-queue", () => academicsQueue.close());
  await upsertRepeatableJob({
    queue: academicsQueue.queue,
    schedulerId: GAP_SCAN_SCHEDULER_ID,
    everyMs: GAP_SCAN_INTERVAL_MS,
    jobName: GAP_SCAN_JOB_NAME,
    payload: { source: "worker-schedule" },
  });

  // Nightly analytics rollup rebuild (#5, ADR-0018): blind precompute.
  await upsertRepeatableJob({
    queue: analyticsQueue.queue,
    schedulerId: ROLLUP_SCHEDULER_ID,
    everyMs: ROLLUP_INTERVAL_MS,
    jobName: ROLLUP_JOB_NAME,
    payload: { source: "worker-schedule" },
  });

  const observability = createMetricsServer({
    port: config.worker.metricsPort,
    metrics,
    logger,
    checks: [
      { name: "postgres", check: () => pingPostgres(pool) },
      { name: "redis", check: () => pingRedis(redis) },
    ],
    isDraining: () => lifecycle.isDraining,
  });
  lifecycle.onShutdown("observability-server", () => observability.close());

  lifecycle.attachSignalHandlers();
  logger.info(
    {
      modules: modules.map((module) => module.definition.name),
      metricsPort: config.worker.metricsPort,
      heartbeatIntervalMs: config.worker.systemHeartbeatIntervalMs,
      env: config.env,
    },
    "worker started",
  );
}

main().catch((error: unknown) => {
  // The logger may not exist if config parsing failed; stderr is the floor.
  console.error("worker failed to start:", error);
  process.exit(1);
});
