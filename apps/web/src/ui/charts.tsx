import type { AggState, AttendanceSummary, MarksSummary, StripSection } from "./api";
import { densityBucket, subjectColor } from "./api";

/*
 * Hand-rolled marks per the dataviz method: thin lines (2px), 4px rounded
 * data-ends, recessive grid, one axis, direct labels rather than a colour-only
 * legend. No chart library — plain SVG so every mark is intentional and the
 * bundle stays CDN-free.
 */

export function StatTile({
  value,
  label,
  sub,
  muted,
}: {
  value: string;
  label: string;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <div className="stat">
      <div className={`stat-value${muted ? " muted" : ""}`}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub !== undefined ? <div className="stat-sub num">{sub}</div> : null}
    </div>
  );
}

/** Single-series trend. Title names the series, so no legend box (dataviz rule 6). */
export function Sparkline({
  points,
  label,
  unit = "%",
}: {
  points: { x: string; y: number }[];
  label: string;
  unit?: string;
}) {
  if (points.length === 0) {
    return <div className="strip-empty">No trend yet.</div>;
  }
  const w = 280;
  const h = 68;
  const padX = 6;
  const padY = 10;
  const n = points.length;
  const stepX = n === 1 ? 0 : (w - padX * 2) / (n - 1);
  const yFor = (v: number) => h - padY - (Math.max(0, Math.min(100, v)) / 100) * (h - padY * 2);
  const xFor = (i: number) => (n === 1 ? w / 2 : padX + i * stepX);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${xFor(n - 1).toFixed(1)},${h - padY} L${xFor(0).toFixed(1)},${h - padY} Z`;
  const last = points[n - 1]!;
  const summary = points.map((p) => `${p.x}: ${p.y}${unit}`).join(", ");
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      role="img"
      aria-label={`${label}. ${summary}`}
      preserveAspectRatio="none"
    >
      <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} stroke="var(--rule)" strokeWidth="1" />
      <path d={area} fill="var(--line)" opacity="0.1" />
      <path
        d={line}
        fill="none"
        stroke="var(--line)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={xFor(n - 1)} cy={yFor(last.y)} r="3.2" fill="var(--line)" />
    </svg>
  );
}

/**
 * Thin categorical bars, each DIRECT-LABELLED with its subject name — this is
 * the secondary encoding that lets the validated palette ship despite two
 * adjacent hues sitting just under the 3:1 relief threshold on paper.
 */
export function SubjectBars({
  rows,
}: {
  rows: { label: string; value: number; index: number }[];
}) {
  if (rows.length === 0) {
    return <div className="strip-empty">No subject marks visible to you yet.</div>;
  }
  return (
    <div role="table" aria-label="Average marks by subject">
      {rows.map((row) => (
        <div className="barrow" role="row" key={`${row.label}-${row.index}`}>
          <span className="barrow-label" role="rowheader" title={row.label}>
            {row.label}
          </span>
          <span className="bartrack" role="cell">
            <span
              className="barfill"
              style={{ width: `${Math.max(2, Math.min(100, row.value))}%`, background: subjectColor(row.index) }}
            />
          </span>
          <span className="barrow-val num" role="cell">
            {row.value.toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** THE SIGNATURE: each section's recent days inked by attendance density. */
export function RegisterStrip({ sections }: { sections: StripSection[] }) {
  const withData = sections.filter((section) => section.days.length > 0);
  if (withData.length === 0) {
    return (
      <div className="strip-empty">
        No sessions recorded yet — the register fills in after the first entry.
      </div>
    );
  }
  return (
    <div className="strip">
      {withData.map((section) => (
        <div className="strip-row" key={section.sectionId}>
          <span className="strip-label" title={`Section ${section.name}`}>
            Sec {section.name}
          </span>
          <span className="strip-cells" role="img" aria-label={ariaForStrip(section)}>
            {section.days.slice(-12).map((day, index) => (
              <span
                key={`${day.heldOn}-${index}`}
                className="strip-cell"
                data-d={densityBucket(day.presentPct)}
                title={`${day.heldOn}: ${day.presentPct}% present`}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function ariaForStrip(section: StripSection): string {
  const avg = Math.round(
    section.days.reduce((sum, day) => sum + day.presentPct, 0) / section.days.length,
  );
  return `Section ${section.name}: ${section.days.length} recent sessions, ${avg}% average attendance`;
}

/** Renders an aggregate slot as a real value or a designed withheld/empty state. */
export function AttendanceSlot({ slot }: { slot: AggState<AttendanceSummary> }) {
  if (slot.state === "ok") {
    return (
      <StatTile
        value={`${slot.value.pct}%`}
        label="Attendance (YTD)"
        sub={`${slot.value.sessions} sessions · ${slot.value.distinctStudents} students`}
      />
    );
  }
  return <WithheldStat label="Attendance" slot={slot} />;
}

export function MarksSlot({ slot, label = "Average marks" }: { slot: AggState<MarksSummary>; label?: string }) {
  if (slot.state === "ok") {
    return (
      <StatTile
        value={`${slot.value.avgPct}%`}
        label={`${label} (YTD)`}
        sub={`${slot.value.nMarks} marks · ${slot.value.distinctStudents} students`}
      />
    );
  }
  return <WithheldStat label={label} slot={slot} />;
}

function WithheldStat({ label, slot }: { label: string; slot: AggState<unknown> }) {
  if (slot.state === "insufficient-cohort") {
    return (
      <div className="stat">
        <div className="stat-value muted">—</div>
        <div className="stat-label">
          {label}: cohort too small to summarise (under {slot.minCohort}).
        </div>
      </div>
    );
  }
  if (slot.state === "denied") {
    return (
      <div className="stat">
        <div className="stat-value muted">—</div>
        <div className="stat-label">{label}: outside your scope.</div>
      </div>
    );
  }
  return (
    <div className="stat">
      <div className="stat-value muted">—</div>
      <div className="stat-label">{label}: no data yet.</div>
    </div>
  );
}
