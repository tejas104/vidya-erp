import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, createLogger, createMetrics } from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";
import { integrationDatabaseUrl } from "./support/db-url";

/**
 * DECISION 2 — the high-water clock mark, against real Postgres.
 *
 * The day arithmetic is unit-tested (clock-watermark.test.ts). What can only
 * be proven here is the STORAGE half: that the mark persists across calls,
 * that advancing it upserts rather than accumulating rows, and that the
 * single-row invariant is enforced by the database rather than by convention.
 */

const logger = createLogger({ level: "silent", serviceName: "vidya-int" });
const { pool, db } = createDb({
  url: integrationDatabaseUrl(),
  poolMax: 3,
  logger,
  applicationName: "vidya-int-clock",
});

const system = createSystemModule({
  db,
  metrics: createMetrics({ serviceName: "vidya-int", defaultMetrics: false }),
  serviceVersion: "integration",
  isDraining: () => false,
  infrastructureChecks: [],
  license: () => ({ kind: "absent" }),
  countActiveStudents: async () => 0,
});

const at = (iso: string) => new Date(`${iso}T09:00:00.000Z`);
// ::text deliberately. node-postgres parses a bare `date` column into a JS
// Date at LOCAL midnight, so on a +05:30 machine "2026-09-11" reads back as
// 2026-09-10T18:30:00Z — a day earlier. The production path never sees this
// (drizzle declares the column `mode: "string"`), but any raw SQL against
// this table must ask for text or it will be off by one in half the world.
const markRows = async () =>
  (await pool.query<{ observed_on: string }>("SELECT observed_on::text FROM sys_clock_watermark"))
    .rows;

beforeEach(async () => {
  await pool.query("DELETE FROM sys_clock_watermark");
});

afterAll(async () => {
  await pool.end();
});

describe("clock high-water mark against real Postgres", () => {
  it("seeds on first observation and persists across calls", async () => {
    expect(await markRows()).toHaveLength(0);
    const first = await system.service.observeClock(at("2026-09-11"));
    expect(first.rolledBackDays).toBeNull();
    expect((await markRows())[0]?.observed_on).toBe("2026-09-11");
  });

  it("advances by upsert — the table never accumulates a second row", async () => {
    await system.service.observeClock(at("2026-09-11"));
    await system.service.observeClock(at("2026-09-12"));
    await system.service.observeClock(at("2026-09-20"));
    const rows = await markRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.observed_on).toBe("2026-09-20");
  });

  it("detects a rollback and does NOT let the rolled-back clock move the mark", async () => {
    await system.service.observeClock(at("2027-06-01"));
    const rolled = await system.service.observeClock(at("2026-01-01"));
    expect(rolled.rolledBackDays).toBe(516);
    expect(rolled.effectiveOn).toBe("2027-06-01");
    // Still at the high-water date: a later boot on a corrected clock must
    // see the same mark, not one laundered down to the rolled-back value.
    expect((await markRows())[0]?.observed_on).toBe("2027-06-01");
  });

  it("enforces one row in the DATABASE, not by convention", async () => {
    await system.service.observeClock(at("2026-09-11"));
    await expect(
      pool.query("INSERT INTO sys_clock_watermark (id, observed_on) VALUES (true, '2030-01-01')"),
    ).rejects.toThrow(/duplicate key/i);
    // The CHECK makes the only other candidate row impossible too.
    await expect(
      pool.query("INSERT INTO sys_clock_watermark (id, observed_on) VALUES (false, '2030-01-01')"),
    ).rejects.toThrow(/check constraint/i);
  });
});
