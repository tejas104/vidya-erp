"use client";
import { useId } from "react";
import styles from "./StatCard.module.css";

export type StatTone = "good" | "warn" | "bad" | "brand";

const R = 24;
const C = 2 * Math.PI * R; // ring circumference

// Per-status SVG linearGradient stops — the one place a gradient is allowed on a
// figure (structural, not a surface fill). All values are tokens from tokens.css.
const STOPS: Record<StatTone, [string, string]> = {
  good: ["var(--ring-good-a)", "var(--ring-good-b)"],
  brand: ["var(--ring-good-a)", "var(--ring-good-b)"],
  warn: ["var(--ring-warn-a)", "var(--ring-warn-b)"],
  bad: ["var(--ring-bad-a)", "var(--ring-bad-b)"],
};
const INK: Record<StatTone, string> = {
  good: "var(--good)",
  brand: "var(--brand)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

/**
 * Dashboard figure: a progress ring with a per-status gradient stroke, a big
 * figure inside, and label/value/sub meta. `display` fills the ring centre;
 * `value` is the meta figure. Both figures render in the mono figure font.
 */
export function StatCard({
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
  tone?: StatTone;
}) {
  const gid = "sc-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const [a, b] = STOPS[tone];
  return (
    <div className={styles.card}>
      <div className={styles.ring}>
        <svg width="56" height="56" aria-hidden="true">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={a} />
              <stop offset="1" stopColor={b} />
            </linearGradient>
          </defs>
          <circle cx="28" cy="28" r={R} stroke="var(--rule)" strokeWidth="6" fill="none" />
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
        <div className={styles.ringValue} data-figure="true" style={{ color: INK[tone] }}>
          {display}
        </div>
      </div>
      <div className={styles.meta}>
        <div className={styles.label}>{label}</div>
        <div className={styles.value} data-figure="true">
          {value}
        </div>
        {sub ? <div className={styles.sub}>{sub}</div> : null}
      </div>
    </div>
  );
}
