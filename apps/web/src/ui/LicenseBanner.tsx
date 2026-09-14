"use client";
import { useEffect, useState } from "react";
import { Card } from "@vidya/ui-system";
import { api, type LicenseInfo, type Role } from "./api";

/**
 * License status banner (#11.75 item 1). Presentation only — see
 * docs/superpowers/specs/2026-08-13-license-verification-design.md,
 * DECISION 1: nothing is ever blocked. This banner is the entire feature;
 * there is no enforcement anywhere behind it.
 *
 * Role gating (the security-relevant part), per the spec table:
 *   >30 days remaining   -> nothing, any role
 *   <=30 days remaining  -> admin only
 *   <=7 days remaining   -> every staff role
 *   expired / grace      -> admin only
 *   invalid / absent     -> admin only
 * A student never sees a licensing banner in any state. This is enforced
 * twice: the fetch below never fires for a student session, AND the
 * underlying route (system.license) is server-side STAFF_ONLY (every role
 * except student), so even a client bug here could not leak status to a
 * student caller.
 */

type Tone = "warn" | "bad";
interface Banner {
  tone: Tone;
  message: string;
}

/** Every role that may see *some* form of this banner — i.e. every role
 * except student. Matches the module's STAFF_ONLY route requirement. */
const STAFF_ROLES: Role[] = ["admin", "principal", "hod", "class_teacher", "teacher", "accountant"];

const TONE_BG: Record<Tone, string> = { warn: "var(--warn-soft)", bad: "var(--bad-soft)" };
const TONE_FG: Record<Tone, string> = { warn: "var(--warn)", bad: "var(--bad)" };

function describe(info: LicenseInfo): Banner | null {
  switch (info.kind) {
    case "valid": {
      if (info.daysRemaining > 30) return null; // the common case: nothing renders
      const days = `${info.daysRemaining} day${info.daysRemaining === 1 ? "" : "s"}`;
      return {
        tone: info.daysRemaining <= 7 ? "bad" : "warn",
        message: `Licence for ${info.claims.customer} expires in ${days} (${info.claims.expiresAt}). Renew when convenient — nothing stops working either way.`,
      };
    }
    case "grace":
    case "expired": {
      const days = `${info.daysOverdue} day${info.daysOverdue === 1 ? "" : "s"}`;
      return {
        tone: "bad",
        message: `Licence for ${info.claims.customer} expired ${days} ago (${info.claims.expiresAt}). Every feature keeps working — renew when convenient.`,
      };
    }
    case "invalid":
      return {
        tone: "bad",
        message: `Licence problem (${info.reason}). The system runs normally — see the system page and contact support.`,
      };
    case "absent":
      return {
        tone: "warn",
        message: "No licence installed. The system runs normally — install one from the system page when ready.",
      };
  }
}

/** Non-admin staff only ever see the <=7-day-remaining warning — never the
 * <=30-day, grace, expired, invalid, or absent states (those stay admin-only
 * per the spec table). */
function describeForStaff(info: LicenseInfo): Banner | null {
  if (info.kind !== "valid" || info.daysRemaining > 7) return null;
  return describe(info);
}

export function LicenseBanner({ roles }: { roles: Role[] }) {
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const isAdmin = roles.includes("admin");
  const isStaff = roles.some((role) => STAFF_ROLES.includes(role));

  useEffect(() => {
    if (!isStaff) return; // no fetch at all for a student session
    let alive = true;
    api
      .systemLicense()
      .then((result) => {
        if (alive) setInfo(result);
      })
      .catch(() => undefined); // presentation-only: a failed fetch just means no banner
    return () => {
      alive = false;
    };
  }, [isStaff]);

  if (!isStaff || info === null) return null;
  const banner = isAdmin ? describe(info) : describeForStaff(info);
  if (banner === null) return null;

  return (
    <div style={{ padding: "var(--space-3) var(--space-5) 0" }}>
      <Card>
        <div
          role={banner.tone === "bad" ? "alert" : "status"}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "var(--space-3)",
            background: TONE_BG[banner.tone],
            color: TONE_FG[banner.tone],
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius)",
          }}
        >
          <span aria-hidden="true">{banner.tone === "bad" ? "⚠" : "ℹ"}</span>
          <p style={{ margin: 0, flex: "1 1 12rem", color: "inherit" }}>{banner.message}</p>
          <a href="/manage/system" style={{ color: "inherit", fontWeight: 600, whiteSpace: "nowrap" }}>
            Licence details
          </a>
        </div>
      </Card>
    </div>
  );
}
