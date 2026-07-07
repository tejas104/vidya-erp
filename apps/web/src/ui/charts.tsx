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

/** A titled multi-month line with an axis (bigger sibling of Sparkline). */
export function TrendLine({
  points,
  label,
  height = 160,
}: {
  points: { x: string; y: number }[];
  label: string;
  height?: number;
}) {
  if (points.length === 0) return <div className="strip-empty">No trend yet.</div>;
  const w = 640;
  const h = height;
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const n = points.length;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const xFor = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const yFor = (v: number) => padT + (1 - Math.max(0, Math.min(100, v)) / 100) * innerH;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${xFor(n - 1).toFixed(1)},${padT + innerH} L${xFor(0).toFixed(1)},${padT + innerH} Z`;
  const summary = points.map((p) => `${p.x}: ${p.y}%`).join(", ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${label}. ${summary}`}>
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={padL} y1={yFor(g)} x2={w - padR} y2={yFor(g)} stroke="var(--rule)" strokeWidth="1" opacity="0.6" />
          <text x={padL - 6} y={yFor(g) + 3} textAnchor="end" fontSize="10" fill="var(--muted, #8a8a8a)">{g}</text>
        </g>
      ))}
      <path d={area} fill="var(--line)" opacity="0.1" />
      <path d={line} fill="none" stroke="var(--line)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={`pt-${i}`} cx={xFor(i)} cy={yFor(p.y)} r="2.6" fill="var(--line)" />
      ))}
      {points.map((p, i) =>
        i === 0 || i === n - 1 || n <= 6 ? (
          <text key={`lb-${i}`} x={xFor(i)} y={h - 8} textAnchor="middle" fontSize="10" fill="var(--muted, #8a8a8a)">
            {p.x}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Per-child comparison: one row each, an attendance bar and a marks bar. */
export function CompareBars({
  rows,
}: {
  rows: { label: string; attendancePct: number | null; marksPct: number | null; atRisk: number }[];
}) {
  if (rows.length === 0) return <div className="strip-empty">Nothing to compare in your scope yet.</div>;
  return (
    <div role="table" aria-label="Comparison across areas">
      {rows.map((row, index) => (
        <div
          role="row"
          key={`${row.label}-${index}`}
          style={{ display: "grid", gridTemplateColumns: "150px 1fr auto", gap: 14, alignItems: "center", padding: "10px 0", borderTop: index === 0 ? "none" : "1px solid var(--rule)" }}
        >
          <span role="rowheader" title={row.label} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.label}
          </span>
          <span role="cell" style={{ display: "grid", gap: 6 }}>
            <CompareMiniBar tag="attend" value={row.attendancePct} tone="var(--series-1)" />
            <CompareMiniBar tag="marks" value={row.marksPct} tone="var(--series-2)" />
          </span>
          <span role="cell" className={`risk-count${row.atRisk === 0 ? " clear" : ""}`} style={{ whiteSpace: "nowrap" }}>
            <span className="risk-dot" aria-hidden="true" />
            {row.atRisk === 0 ? "on track" : `${row.atRisk} at risk`}
          </span>
        </div>
      ))}
    </div>
  );
}

function CompareMiniBar({ tag, value, tone }: { tag: string; value: number | null; tone: string }) {
  if (value === null) {
    return <span className="num" style={{ fontSize: 12, opacity: 0.55 }}>{tag}: withheld</span>;
  }
  return (
    <span style={{ display: "grid", gridTemplateColumns: "50px 1fr 44px", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 11, opacity: 0.7 }}>{tag}</span>
      <span style={{ height: 8, borderRadius: 4, background: "var(--rule)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.max(2, Math.min(100, value))}%`, background: tone }} />
      </span>
      <span className="num" style={{ fontSize: 12, textAlign: "right" }}>{value.toFixed(0)}%</span>
    </span>
  );
}

/** Vertical count bars for distribution bands. */
export function Histogram({
  bands,
  label,
  accent = "var(--series-3)",
}: {
  bands: { label: string; count: number }[];
  label: string;
  accent?: string;
}) {
  if (bands.length === 0) return <div className="strip-empty">No distribution to show.</div>;
  const w = 440;
  const h = 160;
  const padT = 12;
  const padB = 28;
  const gap = 12;
  const max = Math.max(1, ...bands.map((b) => b.count));
  const bw = (w - gap * (bands.length - 1)) / bands.length;
  const summary = bands.map((b) => `${b.label}: ${b.count}`).join(", ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${label}. ${summary}`}>
      {bands.map((b, i) => {
        const bh = (b.count / max) * (h - padT - padB);
        const x = i * (bw + gap);
        const y = h - padB - bh;
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={bw} height={bh} rx="3" fill={accent} opacity={b.count === 0 ? 0.15 : 0.85} />
            {b.count > 0 ? (
              <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize="11" fill="var(--line)">{b.count}</text>
            ) : null}
            <text x={x + bw / 2} y={h - 9} textAnchor="middle" fontSize="10" fill="var(--muted, #8a8a8a)">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** At-risk composition donut with a centre total and a direct legend. */
export function RiskDonut({
  segments,
  total,
  label,
}: {
  segments: { label: string; value: number; tone: string }[];
  total: number;
  label: string;
}) {
  const size = 160;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  const sum = segments.reduce((acc, s) => acc + s.value, 0);
  const summary = segments.map((s) => `${s.label}: ${s.value}`).join(", ");
  let offset = 0;
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${label}. ${summary}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--rule)" strokeWidth={stroke} />
        {sum > 0 &&
          segments.map((s) => {
            const len = (s.value / sum) * c;
            const node = (
              <circle
                key={s.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.tone}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            );
            offset += len;
            return node;
          })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="30" fontWeight="700" fill="var(--line)">{total}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize="11" fill="var(--muted, #8a8a8a)">at risk</text>
      </svg>
      <div style={{ display: "grid", gap: 7 }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.tone }} aria-hidden="true" />
            {s.label} <span className="num" style={{ opacity: 0.7 }}>{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
