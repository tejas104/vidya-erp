"use client";
import { PageHeader } from "@vidya/ui-system";
import { HelpButton } from "@/ui/help/HelpButton";

export const dynamic = "force-dynamic";

// Baked in at build time by next.config.ts (package.json version + git SHA).
const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";
const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown";

export default function SystemPage() {
  const rows: [string, string][] = [
    ["Version", VERSION],
    ["Build (git SHA)", GIT_SHA],
    ["Deployed version", `${VERSION}+${GIT_SHA}`],
  ];
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="About this deployment"
        lede="The running version, for the license register's deployed-version column and support requests."
        help={<HelpButton slug="system" />}
      />
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "var(--space-2) var(--space-5)", margin: 0 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt style={{ opacity: 0.7 }}>{label}</dt>
            <dd className="num" style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
