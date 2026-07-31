import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Thin alias: no dedicated analytics screen exists — the charts/KPIs/at-risk
// views the ANALYTICS nav entry promises already live inline on /dashboard
// for the oversight roles (admin/principal/hod). This route exists only so
// the nav entry has its own href/breadcrumb, distinct from the Dashboard
// (TOP) entry's "/dashboard" — reusing that href directly would collide and
// break crumbsFor("/dashboard") === [] for every role, including
// teaching-only staff who never see the analytics view at all.
export default function AnalyticsRedirect() {
  redirect("/dashboard");
}
