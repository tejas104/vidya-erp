import pg from "pg";
import { fileURLToPath } from "node:url";
import { createLogger, migrateUp, migrationStatus } from "@vidya/platform";

/** Separate vendor database. Never add this source to ERP migrationSources(). */
async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "up" && command !== "status") throw new Error("usage: control-plane-migrate.ts <up|status>");
  const url = process.env.CONTROL_PLANE_DATABASE_URL;
  if (!url) throw new Error("CONTROL_PLANE_DATABASE_URL is required");
  const target = new URL(url);
  const erp = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (erp && target.host === erp.host && target.pathname === erp.pathname) {
    throw new Error("control-plane and ERP databases must be different");
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const sources = [{ module: "control-plane", dir: fileURLToPath(new URL("../packages/control-plane/migrations/", import.meta.url)) }];
  try {
    const schoolTables = await pool.query("SELECT to_regclass('ppl_students') AS pupils, to_regclass('idn_users') AS users");
    if (schoolTables.rows[0]?.pupils || schoolTables.rows[0]?.users) {
      throw new Error("refusing control-plane migration in a database containing ERP tables");
    }
    const logger = createLogger({ level: "warn", serviceName: "vidya-control-plane-migrate" });
    if (command === "up") {
      const applied = await migrateUp(pool, sources, logger);
      for (const migration of applied) console.log(`applied ${migration.module}/${migration.name}`);
    } else {
      const status = await migrationStatus(pool, sources);
      console.log(`${status.applied.length} applied, ${status.pending.length} pending`);
    }
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  console.error("control-plane migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
