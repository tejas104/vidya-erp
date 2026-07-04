import {
  createDb,
  createLogger,
  createMetrics,
  createRedis,
} from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";
import { createIdentityCore, createIdentityModule } from "@vidya/module-identity";

/**
 * One-time platform bootstrap: creates the FIRST admin account (active,
 * college-wide admin grant, audited as system). Refuses when any admin
 * already exists — afterwards user management goes through the API.
 *
 *   VIDYA_ADMIN_PASSWORD=... tsx scripts/create-admin.ts \
 *     --username root-admin --display-name "Root Admin" --college-id col-main
 *
 * Requires DATABASE_URL and REDIS_URL. The password comes from the
 * environment (never argv — argv leaks into process listings). Requires the
 * HUMAN-OWNED security core (fails closed without it, like the apps).
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

async function main(): Promise<void> {
  const username = argValue("--username");
  const displayName = argValue("--display-name");
  const collegeId = argValue("--college-id");
  const password = process.env.VIDYA_ADMIN_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;

  const problems: string[] = [];
  if (username === undefined) problems.push("--username is required");
  if (displayName === undefined) problems.push("--display-name is required");
  if (collegeId === undefined) problems.push("--college-id is required (opaque id, #3 contract)");
  if (password === undefined || password.length < 12)
    problems.push("VIDYA_ADMIN_PASSWORD env var is required (min 12 chars)");
  if (databaseUrl === undefined || databaseUrl === "") problems.push("DATABASE_URL is required");
  if (redisUrl === undefined || redisUrl === "") problems.push("REDIS_URL is required");
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`error: ${problem}`);
    }
    process.exit(2);
  }

  const logger = createLogger({ level: "warn", serviceName: "vidya-create-admin" });
  const metrics = createMetrics({ serviceName: "vidya-create-admin", defaultMetrics: false });
  const { pool, db } = createDb({
    url: databaseUrl as string,
    poolMax: 2,
    logger,
    applicationName: "vidya-create-admin",
  });
  const redis = createRedis({ url: redisUrl as string, logger, connectionName: "vidya-create-admin" });

  try {
    const system = createSystemModule({
      db,
      metrics,
      serviceVersion: "cli",
      isDraining: () => false,
      infrastructureChecks: [],
    });
    const core = createIdentityCore({ redis, session: { ttlHours: 12, idleMinutes: 30 } });
    const identity = createIdentityModule({
      db,
      redis,
      metrics,
      audit: system.service.audit,
      core,
      config: {
        session: { cookieName: "vidya_session", cookieSecure: true, ttlHours: 12, idleMinutes: 30 },
        resetTokenTtlMinutes: 30,
        throttle: { maxAttempts: 5, windowMinutes: 15 },
      },
    });
    const { userId } = await identity.service.bootstrapAdmin({
      username: username as string,
      displayName: displayName as string,
      password: password as string,
      collegeId: collegeId as string,
    });
    console.log(`admin created: ${username} (${userId}) — college ${collegeId}`);
  } finally {
    redis.disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("create-admin failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
