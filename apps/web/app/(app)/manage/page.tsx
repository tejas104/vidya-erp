"use client";
import { PageHeader } from "@/ui/PageHeader";
export const dynamic = "force-dynamic";
export default function ManageIndex() {
  return (
    <PageHeader
      eyebrow="Manage"
      title="The office"
      lede="Pick a task from the sidebar. You only see the areas your role can act on."
    />
  );
}
