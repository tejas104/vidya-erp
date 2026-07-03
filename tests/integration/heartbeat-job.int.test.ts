import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  createLogger,
  createMetrics,
  createModuleQueue,
  createModuleWorker,
  createQueueEvents,
  type QueueEventsHandle,
  type QueueHandle,
  type WorkerHandle,
} from "@vidya/platform";
import {
  HEARTBEAT_JOB_NAME,
  SYSTEM_MODULE_NAME,
  createSystemModule,
} from "@vidya/module-system";

/**
 * THE reference end-to-end path (Definition of Done): a job enqueued to
 * Redis, picked up by a real BullMQ worker running the system module's
 * processor, landing as a row in the append-only audit table.
 */

const logger = createLogger({ level: "silent", serviceName: "vidya-int" });
const redisUrl = process.env.REDIS_URL ?? "";
const { pool, db } = createDb({
  url: process.env.DATABASE_URL ?? "",
  poolMax: 3,
  logger,
  applicationName: "vidya-int-heartbeat",
});
const metrics = createMetrics({ serviceName: "vidya-int", defaultMetrics: false });

const system = createSystemModule({
  db,
  metrics,
  serviceVersion: "integration",
  isDraining: () => false,
  infrastructureChecks: [],
});

let queueHandle: QueueHandle;
let workerHandle: WorkerHandle;
let eventsHandle: QueueEventsHandle;

beforeAll(async () => {
  queueHandle = createModuleQueue({ module: SYSTEM_MODULE_NAME, redisUrl });
  await queueHandle.queue.obliterate({ force: true });
  eventsHandle = createQueueEvents({ module: SYSTEM_MODULE_NAME, redisUrl });
  await eventsHandle.events.waitUntilReady();
  workerHandle = createModuleWorker({
    module: SYSTEM_MODULE_NAME,
    redisUrl,
    logger,
    metrics,
    jobs: system.definition.jobs.map((spec) => ({
      spec,
      processor: system.jobProcessors[spec.name]!,
    })),
  });
  await workerHandle.worker.waitUntilReady();
});

afterAll(async () => {
  await workerHandle.close();
  await eventsHandle.close();
  await queueHandle.close();
  await pool.end();
});

describe("heartbeat job through Redis + BullMQ + Postgres", () => {
  it("processes an enqueued heartbeat and writes the audit row", async () => {
    const marker = randomUUID();
    const job = await queueHandle.queue.add(HEARTBEAT_JOB_NAME, {
      source: "integration-test",
      note: marker,
    });
    await job.waitUntilFinished(eventsHandle.events, 30_000);

    const recent = await system.service.readRecentAuditEvents(50);
    const row = recent.find(
      (entry) =>
        entry.action === "system.heartbeat" &&
        (entry.details as { note?: string }).note === marker,
    );
    expect(row).toBeDefined();
    expect(row).toMatchObject({ module: "system", actorType: "system", resourceType: "worker" });
    expect((row?.details as { source: string }).source).toBe("integration-test");

    const counter = await metrics.jobsTotal.get();
    const success = counter.values.find(
      (value) => value.labels.outcome === "success" && value.labels.job === HEARTBEAT_JOB_NAME,
    );
    expect(success?.value).toBeGreaterThanOrEqual(1);
  });

  it("fails a malformed payload without retries (unrecoverable)", async () => {
    const job = await queueHandle.queue.add(HEARTBEAT_JOB_NAME, { bogus: true });
    await expect(job.waitUntilFinished(eventsHandle.events, 30_000)).rejects.toThrow(
      /payload failed validation/,
    );
    const state = await queueHandle.queue.getJob(job.id ?? "");
    expect(state?.attemptsMade).toBe(1);
  });
});
