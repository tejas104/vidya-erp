import { subscriptionAccess, type SubscriptionAccess } from "./subscription-access";
import type { TenantRow } from "./registry-repo";

export type TenantAccessView = Readonly<{
  tenantId: string;
  schoolName: string;
  recordedState: string | null;
  paidThrough: string | null;
  access: SubscriptionAccess;
  needsAttention: boolean;
}>;

/** Operator read model. The recorded state is not the effective access mode. */
export function tenantAccessView(row: TenantRow, asOf: Date): TenantAccessView {
  const access = subscriptionAccess(row.subscription_state === null ? null : {
    state: row.subscription_state,
    paidThrough: row.paid_through,
    graceDays: row.grace_days,
  }, asOf);
  return {
    tenantId: row.id,
    schoolName: row.school_name,
    recordedState: row.subscription_state,
    paidThrough: row.paid_through,
    access,
    needsAttention: row.deployment_state === "failed" ||
      (["ready_for_onboarding", "active"].includes(row.deployment_state) &&
        (access.mode === "read_only" || access.reason === "grace")),
  };
}
