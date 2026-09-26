import type { TenantOverview } from "./OperatorDashboard";
import { subscriptionAccess } from "@vidya/control-plane";

/** Fictional UX data; never load school records into the vendor plane. */
const scenarioDate = new Date("2026-09-26T12:00:00Z");
const scenarios: Omit<TenantOverview, "access">[] = [
  { id: "demo-1", code: "greenfield", name: "Greenfield School", city: "Jaipur", deployment: "active", subscription: "active", paidThrough: "2027-03-31", seats: 620, release: "2026.09" },
  { id: "demo-2", code: "riverbend", name: "Riverbend Academy", city: "Pune", deployment: "active", subscription: "grace", paidThrough: "2026-09-20", seats: 340, release: "2026.09" },
  { id: "demo-3", code: "cedarhill", name: "Cedar Hill Public School", city: "Lucknow", deployment: "ready_for_onboarding", subscription: "trial", paidThrough: "2026-10-15", seats: 510, release: "2026.09" },
  { id: "demo-4", code: "northstar", name: "Northstar School", city: "Indore", deployment: "failed", subscription: "trial", paidThrough: "2026-10-20", seats: 270, release: "Not deployed" },
  { id: "demo-5", code: "harborview", name: "Harborview School", city: "Bhopal", deployment: "active", subscription: "active", paidThrough: "2026-07-31", seats: 460, release: "2026.09" },
];

export const syntheticTenants: TenantOverview[] = scenarios.map((tenant) => ({
  ...tenant,
  access: subscriptionAccess({ state: tenant.subscription, paidThrough: tenant.paidThrough, graceDays: 30 }, scenarioDate),
}));
