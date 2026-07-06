import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createLogger, migrateDown, migrateUp, migrationStatus } from "@vidya/platform";
import { migrationSources } from "../../scripts/registry";

const logger = createLogger({ level: "silent", serviceName: "vidya-int" });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const sources = migrationSources();

afterAll(async () => {
  await pool.end();
});

async function tableExists(name: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
    [name],
  );
  return (result.rowCount ?? 0) > 0;
}

describe("migration harness (ADR-0008)", () => {
  it("reports the system audit migration as applied after global setup", async () => {
    const status = await migrationStatus(pool, sources);
    expect(status.pending).toHaveLength(0);
    expect(status.applied.map((entry) => `${entry.module}/${entry.name}`)).toContain(
      "system/0000_audit_log",
    );
  });

  it("rolls back and reapplies every module's migrations (forward + rollback proof)", async () => {
    expect(await tableExists("sys_audit_log")).toBe(true);
    expect(await tableExists("idn_users")).toBe(true);

    const applied = await migrationStatus(pool, sources);
    const rolledBack = await migrateDown(pool, sources, applied.applied.length, logger);
    expect(rolledBack.length).toBe(applied.applied.length);
    expect(await tableExists("sys_audit_log")).toBe(false);
    expect(await tableExists("idn_users")).toBe(false);
    expect(await tableExists("idn_scope_grants")).toBe(false);

    const reapplied = await migrateUp(pool, sources, logger);
    expect(reapplied.map((entry) => `${entry.module}/${entry.name}`)).toEqual([
      "system/0000_audit_log",
      "identity/0000_identity",
      "identity/0001_grant_provenance",
      "people/0000_people",
      "academics/0000_academics",
      "analytics/0000_analytics",
    ]);
    expect(await tableExists("sys_audit_log")).toBe(true);
    expect(await tableExists("idn_users")).toBe(true);
    expect(await tableExists("ppl_colleges")).toBe(true);
    expect(await tableExists("ppl_teacher_assignments")).toBe(true);
    expect(await tableExists("acd_marks")).toBe(true);
    expect(await tableExists("anl_marks_rollups")).toBe(true);
    expect(await tableExists("anl_student_flags")).toBe(true);
  });

  it("is idempotent — a second up run applies nothing", async () => {
    const applied = await migrateUp(pool, sources, logger);
    expect(applied).toHaveLength(0);
  });

  it("journals applied migrations in platform_migrations", async () => {
    const result = await pool.query(
      "SELECT module, name FROM platform_migrations ORDER BY id",
    );
    expect(result.rows).toContainEqual({ module: "system", name: "0000_audit_log" });
    expect(result.rows).toContainEqual({ module: "identity", name: "0000_identity" });
  });

  it("survives concurrent runners (advisory lock)", async () => {
    const results = await Promise.all([
      migrateUp(pool, sources, logger),
      migrateUp(pool, sources, logger),
    ]);
    expect(results.flat()).toHaveLength(0);
  });

  it("refuses to roll back when the journal references a missing rollback file", async () => {
    const ghost = `9999_ghost_${randomUUID().slice(0, 8)}`;
    await pool.query("INSERT INTO platform_migrations (module, name) VALUES ($1, $2)", [
      "system",
      ghost,
    ]);
    try {
      await expect(migrateDown(pool, sources, 1, logger)).rejects.toThrow(/missing on disk/);
    } finally {
      await pool.query("DELETE FROM platform_migrations WHERE name = $1", [ghost]);
    }
  });
});
