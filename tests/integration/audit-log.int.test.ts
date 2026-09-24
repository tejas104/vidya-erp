import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, createLogger, createMetrics } from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";
import { integrationDatabaseUrl } from "./support/db-url";

const logger = createLogger({ level: "silent", serviceName: "vidya-int" });
const { pool, db } = createDb({
  url: integrationDatabaseUrl(),
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
  // Neither the licence banner nor the seat count has any meaning outside
  // the web app, and nothing here reads them — but SystemModuleDeps
  // requires both, so state the absence explicitly (#11.75).
  license: () => ({ kind: "absent" }),
  countActiveStudents: async () => 0,
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

  it("pages one resource by event id without repeating newer rows", async () => {
    const marker = randomUUID();
    for (const sequence of [1, 2, 3]) {
      await system.service.audit.record({
        module: "system", action: "system.history-check", actorType: "service",
        actorId: "integration-suite", resourceType: "audit-history", resourceId: marker,
        requestId: marker,
        details: { sequence },
      });
    }
    const first = await system.service.readAuditEventsForResource("audit-history", marker, 2);
    expect(first).toHaveLength(2);
    expect(first[0]!.id).toBeGreaterThan(first[1]!.id);
    const second = await system.service.readAuditEventsForResource("audit-history", marker, 2, first[1]!.id);
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBeLessThan(first[1]!.id);
    expect([...first, ...second].map((event) => (event.details as { sequence: number }).sequence)).toEqual([3, 2, 1]);
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
