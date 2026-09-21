import { notFound } from "next/navigation";
import { SchoolReportCardsPage } from "@/ui/SchoolReportCardsPage";

export const dynamic = "force-dynamic";

export default function ReportCardsPage() {
  if (process.env.VIDYA_EDITION !== "school") notFound();
  return <SchoolReportCardsPage />;
}
