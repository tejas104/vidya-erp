import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import type { Logger } from "../logger/logger";

/**
 * Journal-aware migration runner with rollback support.
 *
 * ⚠ HUMAN-REVIEW COMPONENT (ADR-0008). drizzle-kit has no down-migration
 * support (drizzle-team/drizzle-orm#1339, #4005), so applying and rolling
 * back is implemented here. drizzle-kit is still used to GENERATE forward
 * SQL from schema changes; this runner owns EXECUTION.
 *
 * Conventions enforced:
 *  - every module owns a migrations directory of NNNN_snake_case.sql files;
 *  - every up file MUST have a paired NNNN_snake_case.down.sql — discovery
 *    fails otherwise, so rollback coverage cannot silently rot;
 *  - applied migrations are journaled in platform_migrations (the single
 *    platform-owned table, documented in ADR-0008);
 *  - a Postgres advisory lock serializes concurrent runners (safe when
 *    several replicas race to migrate on deploy);
 *  - each migration (and its journal write) runs in one transaction.
 */

export interface ModuleMigrationSource {
  readonly module: string;
  /** Absolute path to the module's migrations directory. */
  readonly dir: string;
}

export interface MigrationPair {
  readonly module: string;
  /** File stem, e.g. "0000_audit_log". Ordering key within a module. */
  readonly name: string;
  readonly upPath: string;
  readonly downPath: string;
}

export interface AppliedMigration {
  readonly id: number;
  readonly module: string;
  readonly name: string;
  readonly appliedAt: Date;
}

export interface MigrationStatus {
  readonly applied: readonly AppliedMigration[];
  readonly pending: readonly MigrationPair[];
}

const UP_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const DOWN_SUFFIX = ".down.sql";
/** Arbitrary constant; all Vidya migrators contend on the same lock. */
const ADVISORY_LOCK_KEY = 727_271;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/** Lists a module's migrations, enforcing naming and up/down pairing. */
export async function discoverMigrations(
  source: ModuleMigrationSource,
): Promise<MigrationPair[]> {
  const entries = await readdir(source.dir);
  const upFiles = entries.filter(
    (file) => file.endsWith(".sql") && !file.endsWith(DOWN_SUFFIX),
  );
  const downFiles = new Set(entries.filter((file) => file.endsWith(DOWN_SUFFIX)));

  const pairs: MigrationPair[] = [];
  for (const file of upFiles.sort()) {
    if (!UP_FILE_PATTERN.test(file)) {
      throw new MigrationError(
        `module "${source.module}": migration file "${file}" does not match NNNN_snake_case.sql`,
      );
    }
    const name = file.slice(0, -".sql".length);
    const downFile = `${name}${DOWN_SUFFIX}`;
    if (!downFiles.has(downFile)) {
      throw new MigrationError(
        `module "${source.module}": migration "${file}" has no paired rollback file "${downFile}"`,
      );
    }
    downFiles.delete(downFile);
    pairs.push({
      module: source.module,
      name,
      upPath: path.join(source.dir, file),
      downPath: path.join(source.dir, downFile),
    });
  }
  if (downFiles.size > 0) {
    throw new MigrationError(
      `module "${source.module}": orphan rollback file(s) with no up migration: ${[...downFiles].join(", ")}`,
    );
  }
  return pairs;
}

/**
 * Computes which discovered migrations still need applying. Pure function —
 * unit-tested independently of Postgres. Fails on drift: a journaled
 * migration that no longer exists on disk, or a gap (unapplied migration
 * ordered before an applied one within the same module).
 */
export function planUp(
  discovered: readonly MigrationPair[],
  applied: readonly Pick<AppliedMigration, "module" | "name">[],
): MigrationPair[] {
  const appliedKeys = new Set(applied.map((row) => `${row.module}/${row.name}`));
  const discoveredKeys = new Set(discovered.map((pair) => `${pair.module}/${pair.name}`));

  for (const row of applied) {
    const key = `${row.module}/${row.name}`;
    if (!discoveredKeys.has(key)) {
      throw new MigrationError(
        `journal drift: "${key}" is recorded as applied but missing on disk`,
      );
    }
  }

  const pending: MigrationPair[] = [];
  const seenPendingByModule = new Set<string>();
  for (const pair of discovered) {
    const key = `${pair.module}/${pair.name}`;
    if (appliedKeys.has(key)) {
      if (seenPendingByModule.has(pair.module)) {
        throw new MigrationError(
          `ordering drift in module "${pair.module}": "${pair.name}" is applied but an earlier migration is not`,
        );
      }
      continue;
    }
    seenPendingByModule.add(pair.module);
    pending.push(pair);
  }
  return pending;
}

async function ensureJournal(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_migrations (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      module text NOT NULL,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (module, name)
    )
  `);
}

async function readApplied(client: pg.PoolClient): Promise<AppliedMigration[]> {
  const result = await client.query(
    "SELECT id, module, name, applied_at FROM platform_migrations ORDER BY id",
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    module: String(row.module),
    name: String(row.name),
    appliedAt: new Date(row.applied_at),
  }));
}

async function withMigrationLock<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    try {
      await ensureJournal(client);
      return await fn(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function discoverAll(
  sources: readonly ModuleMigrationSource[],
): Promise<MigrationPair[]> {
  const all: MigrationPair[] = [];
  for (const source of sources) {
    all.push(...(await discoverMigrations(source)));
  }
  return all;
}

export async function migrateUp(
  pool: pg.Pool,
  sources: readonly ModuleMigrationSource[],
  logger: Logger,
): Promise<MigrationPair[]> {
  const discovered = await discoverAll(sources);
  return withMigrationLock(pool, async (client) => {
    const applied = await readApplied(client);
    const pending = planUp(discovered, applied);
    for (const pair of pending) {
      const sql = await readFile(pair.upPath, "utf8");
      logger.info({ module: pair.module, migration: pair.name }, "applying migration");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO platform_migrations (module, name) VALUES ($1, $2)",
          [pair.module, pair.name],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new MigrationError(
          `migration "${pair.module}/${pair.name}" failed and was rolled back: ${String(error)}`,
        );
      }
    }
    logger.info({ appliedNow: pending.length }, "migrations up to date");
    return pending;
  });
}

export async function migrateDown(
  pool: pg.Pool,
  sources: readonly ModuleMigrationSource[],
  steps: number,
  logger: Logger,
): Promise<AppliedMigration[]> {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new MigrationError(`rollback steps must be a positive integer, got ${steps}`);
  }
  const discovered = await discoverAll(sources);
  const byKey = new Map(discovered.map((pair) => [`${pair.module}/${pair.name}`, pair]));

  return withMigrationLock(pool, async (client) => {
    const applied = await readApplied(client);
    const targets = applied.slice(-steps).reverse();
    for (const target of targets) {
      const pair = byKey.get(`${target.module}/${target.name}`);
      if (pair === undefined) {
        throw new MigrationError(
          `cannot roll back "${target.module}/${target.name}": rollback file missing on disk`,
        );
      }
      const sql = await readFile(pair.downPath, "utf8");
      logger.info({ module: target.module, migration: target.name }, "rolling back migration");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("DELETE FROM platform_migrations WHERE id = $1", [target.id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new MigrationError(
          `rollback of "${target.module}/${target.name}" failed and was aborted: ${String(error)}`,
        );
      }
    }
    logger.info({ rolledBack: targets.length }, "rollback complete");
    return targets;
  });
}

export async function migrationStatus(
  pool: pg.Pool,
  sources: readonly ModuleMigrationSource[],
): Promise<MigrationStatus> {
  const discovered = await discoverAll(sources);
  return withMigrationLock(pool, async (client) => {
    const applied = await readApplied(client);
    const pending = planUp(discovered, applied);
    return { applied, pending };
  });
}
