"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@vidya/ui-system";
import { HelpButton } from "@/ui/help/HelpButton";
import { api, type LicenseInfo } from "@/ui/api";

export const dynamic = "force-dynamic";

// Baked in at build time by next.config.ts (package.json version + git SHA).
const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";
const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown";

// House convention for digit grouping (matches apps/web/src/ui/money.ts).
const numberFmt = new Intl.NumberFormat("en-IN");

const EDITION_LABEL: Record<string, string> = { college: "College", school: "School" };

/** Licence-derived rows only — Version/Build/Deployed are always available
 * from build-time env, never behind this. `null` means "still loading";
 * every LicenseInfo variant below resolves to real strings, never blank. */
function licenseRows(info: LicenseInfo | null): [string, string][] {
  if (info === null) {
    return [
      ["Licensed institution", "Loading…"],
      ["Edition", "Loading…"],
      ["Expiry", "Loading…"],
      ["Seat usage", "Loading…"],
    ];
  }
  if (info.kind === "absent") {
    return [
      ["Licensed institution", "No licence installed"],
      ["Edition", "—"],
      ["Expiry", "—"],
      ["Seat usage", `${numberFmt.format(info.studentCount)} active student${info.studentCount === 1 ? "" : "s"} (no licence to compare against)`],
    ];
  }
  if (info.kind === "invalid") {
    return [
      ["Licensed institution", `Licence invalid (${info.reason})`],
      ["Edition", "—"],
      ["Expiry", "—"],
      ["Seat usage", `${numberFmt.format(info.studentCount)} active student${info.studentCount === 1 ? "" : "s"} (licence invalid, no seat limit to compare)`],
    ];
  }
  // valid, grace, expired all carry claims
  const expiryNote =
    info.kind === "valid"
      ? ` (${info.daysRemaining} day${info.daysRemaining === 1 ? "" : "s"} remaining)`
      : ` (expired ${info.daysOverdue} day${info.daysOverdue === 1 ? "" : "s"} ago)`;
  return [
    ["Licensed institution", info.claims.customer],
    ["Edition", EDITION_LABEL[info.claims.edition] ?? info.claims.edition],
    ["Expiry", `${info.claims.expiresAt}${expiryNote}`],
    ["Seat usage", `${numberFmt.format(info.studentCount)} of ${numberFmt.format(info.claims.seats)} licensed students`],
  ];
}

export default function SystemPage() {
  const [license, setLicense] = useState<LicenseInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .systemLicense()
      .then((result) => {
        if (alive) setLicense(result);
      })
      .catch(() => undefined); // surface-only: a failed fetch just leaves "Loading…"
    return () => {
      alive = false;
    };
  }, []);

  const rows: [string, string][] = [
    ["Version", VERSION],
    ["Build (git SHA)", GIT_SHA],
    ["Deployed version", `${VERSION}+${GIT_SHA}`],
    ...licenseRows(license),
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
