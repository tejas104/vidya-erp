import pg from "pg";
import { createLogger, migrateUp } from "@vidya/platform";
import { migrationSources } from "../../scripts/registry";

/**
 * Integration-suite global setup: brings the target database to the current
 * migration head using the real migration runner (so every integration run
 * also exercises ADR-0008's harness).
 *
 * Set INTEGRATION_RESET_DB=true (CI does) to drop and recreate the public
 * schema first — only ever point this at a disposable database.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "integration tests require DATABASE_URL (start the compose stack: pnpm compose:up)",
    );
  }
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
    throw new Error("integration tests require REDIS_URL");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    if (process.env.INTEGRATION_RESET_DB === "true") {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    }
    await migrateUp(
      pool,
      migrationSources(),
      createLogger({ level: "warn", serviceName: "vidya-integration-setup" }),
    );
  } finally {
    await pool.end();
  }
}
