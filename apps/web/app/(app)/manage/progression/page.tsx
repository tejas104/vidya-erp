import { notFound } from "next/navigation";
import { SchoolProgressionPage } from "@/ui/SchoolProgressionPage";

export const dynamic = "force-dynamic";
export default function ProgressionPage() {
  if (process.env.VIDYA_EDITION !== "school") notFound();
  return <SchoolProgressionPage />;
}
