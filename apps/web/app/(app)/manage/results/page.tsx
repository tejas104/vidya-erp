import CollegeResultsPage from "./CollegeResultsPage";
import { SchoolResultsPage } from "@/ui/SchoolResultsPage";

export const dynamic = "force-dynamic";
export { bandsProblem } from "./CollegeResultsPage";

export default function ResultsPage() {
  return process.env.VIDYA_EDITION === "school" ? <SchoolResultsPage /> : <CollegeResultsPage />;
}
