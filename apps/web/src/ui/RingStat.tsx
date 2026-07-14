"use client";
import { useId } from "react";

export type RingTone = "good" | "warn" | "bad" | "brand";

const R = 24;
const C = 2 * Math.PI * R; // ~150.8

const STOPS: Record<RingTone, [string, string]> = {
  good: ["var(--ring-good-a)", "var(--ring-good-b)"],
  brand: ["var(--ring-good-a)", "var(--ring-good-b)"],
  warn: ["var(--ring-warn-a)", "var(--ring-warn-b)"],
  bad: ["var(--ring-bad-a)", "var(--ring-bad-b)"],
};
const INK: Record<RingTone, string> = {
  good: "var(--good)",
  brand: "var(--brand)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

/**
 * A progress ring with a per-status SVG linearGradient stroke (the one place
 * gradients are allowed on a figure — structural, not a surface fill).
 * `pct` fills the arc; `display` is the text inside; the meta is label/value/sub.
 */
export function RingStat({
  pct,
  display,
  label,
  value,
  sub,
  tone = "good",
}: {
  pct: number;
  display: string;
  label: string;
  value: string;
  sub?: string;
  tone?: RingTone;
}) {
  const gid = "rg-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const [a, b] = STOPS[tone];
  return (
    <div className="cw-ring-card">
      <div className="cw-ring">
        <svg width="56" height="56" aria-hidden="true">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={a} />
              <stop offset="1" stopColor={b} />
            </linearGradient>
          </defs>
          <circle cx="28" cy="28" r={R} stroke="var(--line-2)" strokeWidth="6" fill="none" />
          <circle
            cx="28"
            cy="28"
            r={R}
            stroke={`url(#${gid})`}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - clamped / 100)}
          />
        </svg>
        <div className="cw-ring-v" style={{ color: INK[tone] }}>
          {display}
        </div>
      </div>
      <div className="cw-ring-meta">
        <div className="rk">{label}</div>
        <div className="rv">{value}</div>
        {sub ? <div className="rs">{sub}</div> : null}
      </div>
    </div>
  );
}
