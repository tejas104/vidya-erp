import { notFound } from "next/navigation";
import { SchoolPoliciesPage } from "@/ui/SchoolPoliciesPage";

export const dynamic = "force-dynamic";
export default function Page() {
  if (process.env.VIDYA_EDITION !== "school") notFound();
  return <SchoolPoliciesPage />;
}
