import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/logger";

export type Db = NodePgDatabase<Record<string, never>>;

export interface DbHandle {
  readonly pool: pg.Pool;
  readonly db: Db;
}

export interface DbOptions {
  readonly url: string;
  readonly poolMax: number;
  readonly logger: Logger;
  /** Identifies the process in pg_stat_activity. */
  readonly applicationName: string;
}

export function createDb(options: DbOptions): DbHandle {
  const pool = new pg.Pool({
    connectionString: options.url,
    max: options.poolMax,
    application_name: options.applicationName,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (error) => {
    options.logger.error({ err: error }, "postgres pool error on idle client");
  });
  return { pool, db: drizzle(pool) };
}

/** Liveness probe for the readiness endpoint: cheap round-trip. */
export async function pingPostgres(pool: pg.Pool): Promise<void> {
  await pool.query("select 1");
}
