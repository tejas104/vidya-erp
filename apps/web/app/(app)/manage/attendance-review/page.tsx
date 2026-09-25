import { notFound } from "next/navigation";
import { SchoolAttendanceReviewPage } from "@/ui/SchoolAttendanceReviewPage";

export const dynamic = "force-dynamic";
export default function AttendanceReviewPage() {
  if (process.env.VIDYA_EDITION !== "school") notFound();
  return <SchoolAttendanceReviewPage />;
}
