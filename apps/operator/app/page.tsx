import { notFound } from "next/navigation";
import { OperatorDashboard } from "../src/OperatorDashboard";
import { syntheticTenants } from "../src/synthetic-tenants";

/** This preview has no operator auth or live data. Production has no route. */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <OperatorDashboard tenants={syntheticTenants} />;
}
