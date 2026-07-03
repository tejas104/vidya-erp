import {
  Queue,
  QueueEvents,
  UnrecoverableError,
  Worker,
  type Job,
} from "bullmq";
import type { Logger } from "../logger/logger";
import type { Metrics } from "../metrics/metrics";
import type { JobProcessor, JobSpec } from "../contracts/module";

/**
 * BullMQ wiring. One queue per module (queue name = module name); jobs are
 * addressed by job name within that queue. Each BullMQ component receives
 * its own connection options (never a shared client) — BullMQ blocking
 * commands require dedicated connections, and closing a component then
 * cleanly closes its connection.
 */

interface RedisConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
  readonly db?: number;
  readonly tls?: Record<string, never>;
  readonly maxRetriesPerRequest: null;
  readonly enableReadyCheck: boolean;
  readonly connectionName: string;
}

/** Parses redis:// and rediss:// URLs into ioredis-shaped options. */
export function parseRedisUrl(url: string, connectionName: string): RedisConnectionOptions {
  const parsed = new URL(url);
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error(`unsupported redis URL protocol: ${parsed.protocol}`);
  }
  const dbSegment = parsed.pathname.replace(/^\//, "");
  const db = dbSegment === "" ? undefined : Number(dbSegment);
  if (db !== undefined && (!Number.isInteger(db) || db < 0)) {
    throw new Error("redis URL database segment must be a non-negative integer");
  }
  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 6379 : Number(parsed.port),
    ...(parsed.username !== "" ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password !== "" ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(db !== undefined ? { db } : {}),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName,
  };
}

export interface CreateQueueOptions {
  readonly module: string;
  readonly redisUrl: string;
}

export interface QueueHandle {
  readonly queue: Queue;
  close(): Promise<void>;
}

export function createModuleQueue(options: CreateQueueOptions): QueueHandle {
  const queue = new Queue(options.module, {
    connection: parseRedisUrl(options.redisUrl, `vidya-queue-${options.module}`),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    },
  });
  return {
    queue,
    close: () => queue.close(),
  };
}

export interface RegisteredJob {
  readonly spec: JobSpec;
  readonly processor: JobProcessor;
}

export interface CreateWorkerOptions {
  readonly module: string;
  readonly redisUrl: string;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly jobs: readonly RegisteredJob[];
  readonly concurrency?: number;
}

export interface WorkerHandle {
  readonly worker: Worker;
  /** Waits for in-flight jobs to finish, then closes the connection. */
  close(): Promise<void>;
}

/**
 * One BullMQ Worker per module queue. Payloads are validated against the
 * JobSpec schema before the processor runs; an invalid payload is an
 * UnrecoverableError (retrying cannot fix a malformed payload).
 */
export function createModuleWorker(options: CreateWorkerOptions): WorkerHandle {
  const byName = new Map(options.jobs.map((job) => [job.spec.name, job]));

  const worker = new Worker(
    options.module,
    async (job: Job) => {
      const registered = byName.get(job.name);
      const log = options.logger.child({
        module: options.module,
        job: job.name,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
      });
      if (registered === undefined) {
        throw new UnrecoverableError(
          `queue "${options.module}" has no processor registered for job "${job.name}"`,
        );
      }
      const parsed = registered.spec.payloadSchema.safeParse(job.data);
      if (!parsed.success) {
        throw new UnrecoverableError(
          `job "${job.name}" payload failed validation: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; ")}`,
        );
      }
      const startedAt = performance.now();
      const labels = { module: options.module, job: job.name };
      try {
        await registered.processor(parsed.data, {
          logger: log,
          jobId: job.id ?? "unknown",
          attempt: job.attemptsMade + 1,
        });
        const seconds = (performance.now() - startedAt) / 1000;
        options.metrics.jobsTotal.inc({ ...labels, outcome: "success" });
        options.metrics.jobDurationSeconds.observe({ ...labels, outcome: "success" }, seconds);
        log.info({ durationMs: Math.round(seconds * 1000) }, "job completed");
      } catch (error) {
        const seconds = (performance.now() - startedAt) / 1000;
        options.metrics.jobsTotal.inc({ ...labels, outcome: "failure" });
        options.metrics.jobDurationSeconds.observe({ ...labels, outcome: "failure" }, seconds);
        log.error({ err: error, durationMs: Math.round(seconds * 1000) }, "job failed");
        throw error;
      }
    },
    {
      connection: parseRedisUrl(options.redisUrl, `vidya-worker-${options.module}`),
      concurrency: options.concurrency ?? 5,
    },
  );

  worker.on("error", (error) => {
    options.logger.error({ err: error, module: options.module }, "worker error");
  });

  return {
    worker,
    close: () => worker.close(),
  };
}

export interface QueueEventsHandle {
  readonly events: QueueEvents;
  close(): Promise<void>;
}

/** Used by tests and tooling to await job completion. */
export function createQueueEvents(options: CreateQueueOptions): QueueEventsHandle {
  const events = new QueueEvents(options.module, {
    connection: parseRedisUrl(options.redisUrl, `vidya-events-${options.module}`),
  });
  return {
    events,
    close: () => events.close(),
  };
}

export interface RepeatableJobOptions {
  readonly queue: Queue;
  /** Stable scheduler id — upserting with the same id replaces the schedule. */
  readonly schedulerId: string;
  readonly everyMs: number;
  readonly jobName: string;
  readonly payload: unknown;
}

/** Registers (or updates) a repeating job schedule. Safe across replicas. */
export async function upsertRepeatableJob(options: RepeatableJobOptions): Promise<void> {
  await options.queue.upsertJobScheduler(
    options.schedulerId,
    { every: options.everyMs },
    { name: options.jobName, data: options.payload },
  );
}
