import {
  createDb,
  createLogger,
  createMetrics,
  createModuleQueue,
  createObjectStorage,
  createRedis,
  loadConfig,
  type OrgDirectory,
} from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";
import { createIdentityCore, createIdentityModule } from "@vidya/module-identity";
import { IMPORT_JOB_NAME, PEOPLE_MODULE_NAME, createPeopleModule } from "@vidya/module-people";

/**
 * One-time platform bootstrap: creates (or reuses, by code) the college and
 * creates the FIRST admin account for it (active, college-wide admin grant,
 * audited). Refuses when any admin already exists — afterwards user and org
 * management go through the API.
 *
 *   VIDYA_ADMIN_PASSWORD=... tsx scripts/create-admin.ts \
 *     --username root-admin --display-name "Root Admin" \
 *     --college-name "Govt. Science College" --college-code MAIN
 *
 * Runs with the full app environment (.env) — it composes the real modules,
 * including the human-owned security core, exactly like the apps do.
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

async function main(): Promise<void> {
  const username = argValue("--username");
  const displayName = argValue("--display-name");
  const collegeName = argValue("--college-name");
  const collegeCode = argValue("--college-code");
  const password = process.env.VIDYA_ADMIN_PASSWORD;

  const problems: string[] = [];
  if (username === undefined) problems.push("--username is required");
  if (displayName === undefined) problems.push("--display-name is required");
  if (collegeName === undefined) problems.push("--college-name is required");
  if (collegeCode === undefined) problems.push("--college-code is required");
  if (password === undefined || password.length < 12)
    problems.push("VIDYA_ADMIN_PASSWORD env var is required (min 12 chars)");
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`error: ${problem}`);
    }
    process.exit(2);
  }

  const config = loadConfig();
  const logger = createLogger({ level: "warn", serviceName: "vidya-create-admin" });
  const metrics = createMetrics({ serviceName: "vidya-create-admin", defaultMetrics: false });
  const { pool, db } = createDb({
    url: config.database.url,
    poolMax: 2,
    logger,
    applicationName: "vidya-create-admin",
  });
  const redis = createRedis({ url: config.redis.url, logger, connectionName: "vidya-create-admin" });
  const objectStorage = createObjectStorage(config.s3);
  const peopleQueue = createModuleQueue({ module: PEOPLE_MODULE_NAME, redisUrl: config.redis.url });

  try {
    const system = createSystemModule({
      db,
      metrics,
      serviceVersion: "cli",
      isDraining: () => false,
      infrastructureChecks: [],
    });
    const core = createIdentityCore({
      redis,
      session: {
        ttlHours: config.identity.session.ttlHours,
        idleMinutes: config.identity.session.idleMinutes,
      },
    });
    const orgDirectoryRef: { current: OrgDirectory | null } = { current: null };
    const identity = createIdentityModule({
      db,
      redis,
      metrics,
      audit: system.service.audit,
      core,
      config: config.identity,
      orgDirectory: () => orgDirectoryRef.current,
    });
    const people = createPeopleModule({
      db,
      metrics,
      audit: system.service.audit,
      scopeChecker: core.scopeChecker,
      identityGrants: identity.service.derivedGrants,
      storage: { client: objectStorage, bucket: config.s3.bucket },
      enqueueImport: async (payload) => {
        await peopleQueue.queue.add(IMPORT_JOB_NAME, payload);
      },
    });
    orgDirectoryRef.current = people.service.orgDirectory;

    const college = await people.service.bootstrapCollege({
      name: collegeName as string,
      code: collegeCode as string,
    });
    console.log(
      college.created
        ? `college created: ${collegeName} (${college.collegeId})`
        : `college exists: ${collegeName} (${college.collegeId})`,
    );

    const { userId } = await identity.service.bootstrapAdmin({
      username: username as string,
      displayName: displayName as string,
      password: password as string,
      collegeId: college.collegeId,
    });
    console.log(`admin created: ${username} (${userId}) — college ${college.collegeId}`);
  } finally {
    await peopleQueue.close();
    objectStorage.destroy();
    redis.disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("create-admin failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
