import { notFound } from "next/navigation";
import { SchoolTermsPage } from "@/ui/SchoolTermsPage";

export const dynamic = "force-dynamic";

export default function TermsPage() {
  if (process.env.VIDYA_EDITION !== "school") notFound();
  return <SchoolTermsPage />;
}
