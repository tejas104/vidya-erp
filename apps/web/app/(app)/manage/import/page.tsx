import { redirect } from "next/navigation";

/**
 * The old one-form-fits-all import screen (assignment #3) is now split into
 * dedicated Import Students / Import Staff screens (assignment #11, task
 * A4) — see ./students/page.tsx and ./staff/page.tsx, which share their
 * dry-run/poll/confirm flow via @/ui/useImportRun. This route stays alive
 * only so an old bookmark or link lands somewhere useful.
 */
export default function ImportPage() {
  redirect("/manage/import/students");
}
