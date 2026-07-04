import { Redis } from "ioredis";
import type { Logger } from "../logger/logger";

/** The concrete client type modules receive through their factory deps. */
export type RedisClient = Redis;

export interface RedisOptions {
  readonly url: string;
  readonly logger: Logger;
  /** Shows up in CLIENT LIST for debugging. */
  readonly connectionName: string;
}

/**
 * Shared ioredis factory. maxRetriesPerRequest is null because BullMQ
 * requires it on its connections and we keep one consistent policy.
 */
export function createRedis(options: RedisOptions): Redis {
  const redis = new Redis(options.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: options.connectionName,
  });
  redis.on("error", (error) => {
    options.logger.error({ err: error }, "redis connection error");
  });
  return redis;
}

export async function pingRedis(redis: Redis): Promise<void> {
  const reply = await redis.ping();
  if (reply !== "PONG") {
    throw new Error(`unexpected redis ping reply: ${reply}`);
  }
}
