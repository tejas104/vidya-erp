import pg from "pg";
import {
  createLogger,
  migrateDown,
  migrateUp,
  migrationStatus,
} from "@vidya/platform";
import { migrationSources } from "./registry";

/**
 * Migration CLI (see ADR-0008 — human-review component).
 *
 *   tsx scripts/migrate.ts up                 apply all pending migrations
 *   tsx scripts/migrate.ts down --steps N     roll back the last N migrations
 *   tsx scripts/migrate.ts status             list applied + pending
 *
 * Deliberately requires only DATABASE_URL (not the full app config) so it
 * can run in minimal contexts: CI, an init container, an operator shell.
 */

function parseSteps(argv: readonly string[]): number {
  const index = argv.indexOf("--steps");
  if (index === -1) {
    return 1;
  }
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--steps must be a positive integer, got "${argv[index + 1]}"`);
  }
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "up" && command !== "down" && command !== "status") {
    console.error("usage: migrate.ts <up | down [--steps N] | status>");
    process.exitCode = 2;
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("DATABASE_URL must be set");
    process.exitCode = 2;
    return;
  }

  const logger = createLogger({
    level: process.env.LOG_LEVEL ?? "info",
    serviceName: "vidya-migrate",
  });
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const sources = migrationSources();

  try {
    if (command === "up") {
      const applied = await migrateUp(pool, sources, logger);
      for (const migration of applied) {
        console.log(`applied  ${migration.module}/${migration.name}`);
      }
      console.log(applied.length === 0 ? "nothing to apply" : `${applied.length} migration(s) applied`);
    } else if (command === "down") {
      const steps = parseSteps(process.argv);
      const rolledBack = await migrateDown(pool, sources, steps, logger);
      for (const migration of rolledBack) {
        console.log(`rolled back  ${migration.module}/${migration.name}`);
      }
      console.log(rolledBack.length === 0 ? "nothing to roll back" : `${rolledBack.length} migration(s) rolled back`);
    } else {
      const status = await migrationStatus(pool, sources);
      for (const migration of status.applied) {
        console.log(`applied  ${migration.module}/${migration.name}  at ${migration.appliedAt.toISOString()}`);
      }
      for (const migration of status.pending) {
        console.log(`pending  ${migration.module}/${migration.name}`);
      }
      console.log(`${status.applied.length} applied, ${status.pending.length} pending`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("migration command failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
