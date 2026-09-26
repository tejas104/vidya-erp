import type { TenantOverview } from "./OperatorDashboard";

/** Fictional UX data; never load school records into the vendor plane. */
export const syntheticTenants: TenantOverview[] = [
  { id: "demo-1", code: "greenfield", name: "Greenfield School", city: "Jaipur", deployment: "active", subscription: "active", paidThrough: "2027-03-31", seats: 620, release: "2026.09" },
  { id: "demo-2", code: "riverbend", name: "Riverbend Academy", city: "Pune", deployment: "active", subscription: "grace", paidThrough: "2026-09-20", seats: 340, release: "2026.09" },
  { id: "demo-3", code: "cedarhill", name: "Cedar Hill Public School", city: "Lucknow", deployment: "ready_for_onboarding", subscription: "trial", paidThrough: "2026-10-15", seats: 510, release: "2026.09" },
  { id: "demo-4", code: "northstar", name: "Northstar School", city: "Indore", deployment: "failed", subscription: "trial", paidThrough: "2026-10-20", seats: 270, release: "Not deployed" },
];
