import {
  Lifecycle,
  assertModuleWiring,
  createDb,
  createLogger,
  createMetrics,
  createModuleQueue,
  createModuleWorker,
  createRedis,
  loadConfig,
  pingPostgres,
  pingRedis,
  upsertRepeatableJob,
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
import { createMetricsServer } from "./metrics-server";

const RESET_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

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

  // FAIL-CLOSED BOOT: throws until the HUMAN-OWNED security core lands
  // (ADR-0012); the worker refuses to start half-secured, like the web app.
  const identityCore = createIdentityCore({
    redis,
    session: {
      ttlHours: config.identity.session.ttlHours,
      idleMinutes: config.identity.session.idleMinutes,
    },
  });
  const identity = createIdentityModule({
    db,
    redis,
    metrics,
    audit: system.service.audit,
    core: identityCore,
    config: config.identity,
  });

  const modules: RuntimeModule<unknown>[] = [system, identity];

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
