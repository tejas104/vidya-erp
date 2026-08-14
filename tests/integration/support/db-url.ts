import pg from "pg";

const DEFAULT_INTEGRATION_DB_NAME = "vidya_integration";

/**
 * The integration suite gets its own database — never the one DATABASE_URL
 * points at (that's the demo/dev database the e2e fixtures depend on).
 * Same host/user/port, database name swapped, so nothing beyond the
 * existing compose stack is required. Override the name with
 * INTEGRATION_DB_NAME if a run needs a different scratch database.
 */
export function integrationDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (base === undefined || base === "") {
    throw new Error(
      "integration tests require DATABASE_URL (start the compose stack: pnpm compose:up)",
    );
  }
  const url = new URL(base);
  url.pathname = `/${process.env.INTEGRATION_DB_NAME ?? DEFAULT_INTEGRATION_DB_NAME}`;
  return url.toString();
}

/**
 * Creates the integration database if it doesn't exist yet, so a fresh
 * clone can run the suite with no manual setup. Connects to the server's
 * `postgres` maintenance database to do so — Postgres always has one.
 */
export async function ensureIntegrationDatabaseExists(): Promise<void> {
  const target = new URL(integrationDatabaseUrl());
  const dbName = target.pathname.slice(1);
  const maintenanceUrl = new URL(target.toString());
  maintenanceUrl.pathname = "/postgres";
  const pool = new pg.Pool({ connectionString: maintenanceUrl.toString(), max: 1 });
  try {
    const { rows } = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (rows.length === 0) {
      // Database identifiers can't be parameterized; dbName comes from our
      // own default/env-var constant, never from request/user input.
      await pool.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await pool.end();
  }
}
