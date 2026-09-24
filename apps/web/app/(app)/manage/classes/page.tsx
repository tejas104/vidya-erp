import CollegeClassWorkspacePage from "./CollegeClassWorkspacePage";
import { SchoolClassWorkspacePage } from "@/ui/SchoolClassWorkspacePage";

export const dynamic = "force-dynamic";

export default function ClassWorkspacePage() {
  return process.env.VIDYA_EDITION === "school" ? <SchoolClassWorkspacePage /> : <CollegeClassWorkspacePage />;
}
