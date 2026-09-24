import { notFound } from "next/navigation";
import PortalPage, { type PortalView } from "../page";

export const dynamic = "force-dynamic";

const VIEWS = new Set<PortalView>(["schedule", "assignments", "marks", "exams", "syllabus", "attendance", "fees", "notices"]);

export default async function StudentViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!VIEWS.has(view as PortalView)) notFound();
  return <PortalPage view={view as PortalView} />;
}
