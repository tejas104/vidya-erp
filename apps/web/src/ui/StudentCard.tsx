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

const BAR: Record<"good" | "warn" | "bad", string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

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
  const chips: { cls: string; label: string }[] = [];
  if (flags.short) chips.push({ cls: "short", label: "short" });
  if (flags.backlog) chips.push({ cls: "atkt", label: "backlog" });
  if (flags.fees) chips.push({ cls: "fees", label: "fees due" });
  if (flags.yb) chips.push({ cls: "yb", label: "year-back" });

  return (
    <button type="button" className={`cw-card ${tone}`} onClick={onOpen} aria-label={`${name} — open record`}>
      <div className="cw-card-top">
        <span className="cw-photo" style={{ background: gradient }} aria-hidden="true">
          {initials}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="cw-card-id">{rollNo}</div>
          <div className="cw-card-name">{name}</div>
        </div>
        <div className="cw-card-mini">
          <div className={`cw-mini-v ${pct === null ? "" : pct < 75 ? "low" : "ok"}`}>
            {pct === null ? "—" : `${pct}%`}
          </div>
          <div className="cw-mini-k">ATTEND</div>
        </div>
      </div>
      <div className="cw-bar">
        <i style={{ width: `${pct ?? 0}%`, background: BAR[band(pct)] }} />
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
