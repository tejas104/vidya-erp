import { afterAll } from "vitest";
import { createLogger, createRedis } from "@vidya/platform";
import {
  createSessionManager,
  describeSessionManagerConformance,
} from "@vidya/module-identity/conformance";

/**
 * Runs the SessionManager conformance suite (the ADR-0012 acceptance
 * harness) against the real Redis-backed implementation — real waits, real
 * TTLs, no fakes.
 */

const logger = createLogger({ level: "silent", serviceName: "vidya-int" });
const redis = createRedis({
  url: process.env.REDIS_URL ?? "",
  logger,
  connectionName: "vidya-int-sessions",
});

describeSessionManagerConformance("redis-backed session manager", {
  async create(windows) {
    // Sessions deliberately share Redis keys across manager instances
    // (replicas must see each other's sessions), so test isolation lives
    // here, not in the implementation: a dedicated logical db, flushed for
    // every create. The suite's invalidateAllForUser test counts exactly,
    // so leftovers from earlier tests must be gone. The integration
    // stack's Redis is disposable (compose), and the suite runs with
    // --no-file-parallelism, so the flush cannot race another file.
    await redis.select(15);
    await redis.flushdb();
    return createSessionManager({ redis, session: windows });
  },
});

afterAll(() => {
  redis.disconnect();
});
