import { describe, expect, it } from "vitest";
import { tenantAccessView } from "./tenant-access-view";
import type { TenantRow } from "./registry-repo";

const row: TenantRow = {
  id: "tenant-1", code: "school-one", school_name: "School One", edition: "school",
  planned_seats: 400, deployment_state: "active", created_at: new Date("2026-01-01T00:00:00Z"),
  subscription_state: "active", paid_through: "2026-09-30", grace_days: 30,
  subscription_revision: 1,
};

describe("operator tenant access read model", () => {
  it("shows effective restriction even while the last recorded state remains active", () => {
    const view = tenantAccessView(row, new Date("2026-10-31T00:00:00Z"));
    expect(view).toMatchObject({ recordedState: "active", needsAttention: true,
      access: { mode: "read_only", reason: "grace_ended", daysOverdue: 31,
        downloadsAllowed: true, fullExportAllowed: true } });
  });

  it("flags grace while preserving full access and treats no subscription as unlicensed", () => {
    expect(tenantAccessView(row, new Date("2026-10-01T00:00:00Z"))).toMatchObject({
      needsAttention: true, access: { mode: "full", reason: "grace", daysOverdue: 1 },
    });
    expect(tenantAccessView({ ...row, subscription_state: null, paid_through: null,
      grace_days: null, subscription_revision: null }, new Date("2026-09-26T00:00:00Z"))).toMatchObject({
      needsAttention: true, access: { mode: "read_only", reason: "invalid_record" },
    });
  });

  it("keeps a not-yet-deployed tenant out of renewal attention", () => {
    const unlicensed = { ...row, subscription_state: null, paid_through: null,
      grace_days: null, subscription_revision: null };
    expect(tenantAccessView({ ...unlicensed, deployment_state: "requested" },
      new Date("2026-09-26T00:00:00Z")).needsAttention).toBe(false);
    expect(tenantAccessView({ ...unlicensed, deployment_state: "ready_for_onboarding" },
      new Date("2026-09-26T00:00:00Z")).needsAttention).toBe(true);
  });
});
