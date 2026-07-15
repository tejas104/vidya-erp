"use client";

export interface StudentFlags {
  short?: boolean;
  /** carrying an ATKT backlog (lifecycle status) */
  backlog?: boolean;
  fees?: boolean;
  yb?: boolean;
}

/** Attendance bands: green ≥75, amber 65–74, red <65 (the college 75% rule). */
function band(pct: number | null): "good" | "warn" | "bad" {
  if (pct === null) return "good";
  if (pct < 65) return "bad";
  if (pct < 75) return "warn";
  return "good";
}
const COLOR: Record<"good" | "warn" | "bad", string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

const RR = 17;
const RC = 2 * Math.PI * RR; // ~106.8

export function StudentCard({
  initials,
  gradient,
  rollNo,
  name,
  pct,
  flags,
  onOpen,
}: {
  initials: string;
  gradient: string;
  rollNo: string;
  name: string;
  pct: number | null;
  flags: StudentFlags;
  onOpen: () => void;
}) {
  // The edge escalates: year-back or <65 is critical; short/backlog is a watch.
  const tone = flags.yb || (pct !== null && pct < 65) ? "bad" : (pct !== null && pct < 75) || flags.backlog ? "warn" : "";
  const b = band(pct);
  const chips: { cls: string; label: string }[] = [];
  if (flags.short) chips.push({ cls: "short", label: "short" });
  if (flags.backlog) chips.push({ cls: "atkt", label: "backlog" });
  if (flags.fees) chips.push({ cls: "fees", label: "fees due" });
  if (flags.yb) chips.push({ cls: "yb", label: "year-back" });

  return (
    <button type="button" className={`cw-card cw-card--v2 ${tone}`} onClick={onOpen} aria-label={`${name} — open record`}>
      <div className="cw-card-top">
        <span className="cw-photo" style={{ background: gradient }} aria-hidden="true">
          {initials}
        </span>
        <div className="cw-card-idwrap">
          <div className="cw-card-name">{name}</div>
          <div className="cw-card-id">{rollNo}</div>
        </div>
        <div className="cw-ring-mini" title={pct === null ? "no attendance yet" : `${pct}% attendance`}>
          <svg width="42" height="42" aria-hidden="true">
            <circle cx="21" cy="21" r={RR} stroke="var(--line-2)" strokeWidth="5" fill="none" />
            <circle
              cx="21"
              cy="21"
              r={RR}
              stroke={COLOR[b]}
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={RC}
              strokeDashoffset={RC * (1 - (pct ?? 0) / 100)}
            />
          </svg>
          <span style={{ color: pct === null ? "var(--ink-3)" : COLOR[b] }}>{pct === null ? "—" : `${pct}`}</span>
        </div>
      </div>
      <div className="cw-flags">
        {chips.length === 0 ? (
          <span className="cw-badge ok">clear</span>
        ) : (
          chips.map((c) => (
            <span key={c.cls} className={`cw-badge ${c.cls}`}>
              {c.label}
            </span>
          ))
        )}
      </div>
    </button>
  );
}
