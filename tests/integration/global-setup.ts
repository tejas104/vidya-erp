import pg from "pg";
import { createLogger, migrateUp } from "@vidya/platform";
import { migrationSources } from "../../scripts/registry";
import { ensureIntegrationDatabaseExists, integrationDatabaseUrl } from "./support/db-url";

/**
 * Integration-suite global setup: brings the integration database (its own
 * scratch database — see support/db-url.ts — never the demo/dev database
 * DATABASE_URL points at) to the current migration head using the real
 * migration runner (so every integration run also exercises ADR-0008's
 * harness). Creates that database first if it doesn't exist yet, so a fresh
 * clone needs no manual setup.
 *
 * Set INTEGRATION_RESET_DB=true (CI does) to drop and recreate the public
 * schema first — safe by construction now, since it only ever targets the
 * disposable integration database.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
    throw new Error("integration tests require REDIS_URL");
  }
  await ensureIntegrationDatabaseExists();
  const pool = new pg.Pool({ connectionString: integrationDatabaseUrl(), max: 2 });
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
