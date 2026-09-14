import AppLayout from "@/ui/AppLayout";

export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: React.ReactNode }) {
  // Runtime setting, matching the composition root; one image serves both editions.
  const edition = process.env.VIDYA_EDITION === "school" ? "school" : "college";
  return <AppLayout edition={edition}>{children}</AppLayout>;
}
