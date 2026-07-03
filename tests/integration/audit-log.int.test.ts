import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, createLogger, createMetrics } from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";

const logger = createLogger({ level: "silent", serviceName: "vidya-int" });
const { pool, db } = createDb({
  url: process.env.DATABASE_URL ?? "",
  poolMax: 3,
  logger,
  applicationName: "vidya-int-audit",
});

const system = createSystemModule({
  db,
  metrics: createMetrics({ serviceName: "vidya-int", defaultMetrics: false }),
  serviceVersion: "integration",
  isDraining: () => false,
  infrastructureChecks: [],
});

afterAll(async () => {
  await pool.end();
});

describe("audit log seam against real Postgres", () => {
  it("persists an event through the public service API and reads it back", async () => {
    const marker = randomUUID();
    await system.service.audit.record({
      module: "system",
      action: "system.integration-check",
      actorType: "service",
      actorId: "integration-suite",
      resourceType: "audit-log",
      resourceId: marker,
      requestId: marker,
      details: { marker },
    });
    const recent = await system.service.readRecentAuditEvents(20);
    const found = recent.find((row) => row.resourceId === marker);
    expect(found).toBeDefined();
    expect(found).toMatchObject({
      module: "system",
      action: "system.integration-check",
      actorType: "service",
      actorId: "integration-suite",
      requestId: marker,
    });
    expect(found?.details).toEqual({ marker });
    expect(found?.occurredAt).toBeInstanceOf(Date);
  });

  it("rejects UPDATE — the table is append-only at the database level", async () => {
    await expect(
      pool.query("UPDATE sys_audit_log SET action = 'tampered' WHERE id IN (SELECT id FROM sys_audit_log LIMIT 1)"),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE", async () => {
    await expect(
      pool.query("DELETE FROM sys_audit_log WHERE id IN (SELECT id FROM sys_audit_log LIMIT 1)"),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects TRUNCATE", async () => {
    await expect(pool.query("TRUNCATE sys_audit_log")).rejects.toThrow(/append-only/);
  });

  it("rejects an invalid actor_type at the database level", async () => {
    await expect(
      pool.query(
        "INSERT INTO sys_audit_log (module, action, actor_type, resource_type) VALUES ('system', 'x', 'robot', 'y')",
      ),
    ).rejects.toThrow(/sys_audit_log_actor_type_check/);
  });
});
