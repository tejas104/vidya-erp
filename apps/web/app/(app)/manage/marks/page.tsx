import CollegeMarksPage from "./CollegeMarksPage";
import { SchoolMarksPage } from "@/ui/SchoolMarksPage";

export const dynamic = "force-dynamic";

export default function MarksPage() {
  return process.env.VIDYA_EDITION === "school" ? <SchoolMarksPage /> : <CollegeMarksPage />;
}
