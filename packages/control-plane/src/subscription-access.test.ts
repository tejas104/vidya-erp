import { describe, expect, it } from "vitest";
import { subscriptionAccess } from "./subscription-access";

const record = { state: "active", paidThrough: "2026-09-30", graceDays: 30 };
const at = (date: string) => new Date(date);

describe("hosted subscription access policy", () => {
  it("includes the paid-through day and 30 full grace days", () => {
    expect(subscriptionAccess(record, at("2026-09-30T23:59:59.999Z"))).toMatchObject({ mode: "full", reason: "within_term" });
    expect(subscriptionAccess(record, at("2026-10-01T00:00:00Z"))).toMatchObject({ mode: "full", reason: "grace", daysOverdue: 1 });
    expect(subscriptionAccess(record, at("2026-10-30T23:59:59Z"))).toMatchObject({ mode: "full", reason: "grace", daysOverdue: 30 });
    expect(subscriptionAccess(record, at("2026-10-31T00:00:00Z"))).toMatchObject({ mode: "read_only", reason: "grace_ended", daysOverdue: 31 });
  });
  it("retains downloads and full export in every restricted result", () => {
    for (const state of ["restricted", "suspended", "cancelled"] as const) {
      expect(subscriptionAccess({ ...record, state }, at("2026-09-20T00:00:00Z"))).toMatchObject({
        mode: "read_only", downloadsAllowed: true, fullExportAllowed: true,
      });
    }
    expect(subscriptionAccess({ ...record, paidThrough: "2026-02-30" }, at("2026-10-31T00:00:00Z"))).toMatchObject({
      mode: "read_only", reason: "invalid_record", downloadsAllowed: true, fullExportAllowed: true,
    });
  });
});
