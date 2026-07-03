import { describe, expect, it, vi } from "vitest";
import type { AuditEvent, Db } from "@vidya/platform";
import { SystemAuditLogger, readRecentAuditEvents } from "./audit-writer";

const event: AuditEvent = {
  module: "system",
  action: "system.heartbeat",
  actorType: "system",
  actorId: null,
  resourceType: "worker",
  resourceId: null,
  requestId: "req-9",
  details: { source: "test" },
};

describe("SystemAuditLogger", () => {
  it("maps the audit event onto the sys_audit_log columns", async () => {
    const values = vi.fn(async () => undefined);
    const insert = vi.fn(() => ({ values }));
    const db = { insert } as unknown as Db;
    await new SystemAuditLogger(db).record(event);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({
      module: "system",
      action: "system.heartbeat",
      actorType: "system",
      actorId: null,
      resourceType: "worker",
      resourceId: null,
      requestId: "req-9",
      details: { source: "test" },
    });
  });

  it("propagates insert failures (fail-closed for callers)", async () => {
    const db = {
      insert: () => ({
        values: async () => {
          throw new Error("insert failed");
        },
      }),
    } as unknown as Db;
    await expect(new SystemAuditLogger(db).record(event)).rejects.toThrow(/insert failed/);
  });
});

describe("readRecentAuditEvents", () => {
  it("validates the limit bounds", async () => {
    const db = {} as Db;
    await expect(readRecentAuditEvents(db, 0)).rejects.toThrow(RangeError);
    await expect(readRecentAuditEvents(db, 1001)).rejects.toThrow(RangeError);
    await expect(readRecentAuditEvents(db, 2.5)).rejects.toThrow(RangeError);
  });

  it("queries newest-first with the requested limit", async () => {
    const rows = [{ id: 2 }, { id: 1 }];
    const limit = vi.fn(async () => rows);
    const orderBy = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ orderBy }));
    const db = { select: vi.fn(() => ({ from })) } as unknown as Db;
    const result = await readRecentAuditEvents(db, 2);
    expect(result).toBe(rows);
    expect(limit).toHaveBeenCalledWith(2);
  });
});
