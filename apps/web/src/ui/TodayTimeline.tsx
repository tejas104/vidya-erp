"use client";
import type { TtToday } from "@/ui/api";

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const fmt = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * The teacher's day as a timeline, with a live "now" line placed by the clock.
 * Past periods dim; the period spanning now is highlighted. Pass
 * `markedPeriodNos` to tag periods whose attendance is already recorded —
 * omitted (not faked) until that per-period signal is wired.
 */
export function TodayTimeline({
  today,
  nowMinutes,
  markedPeriodNos,
}: {
  today: TtToday;
  nowMinutes?: number;
  markedPeriodNos?: ReadonlySet<number>;
}) {
  const now = nowMinutes ?? (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();
  const periods = new Map(today.periods.map((p) => [p.periodNo, p]));
  const rows = today.entries
    .map((e) => {
      const p = periods.get(e.periodNo);
      const start = p ? toMin(p.starts) : 0;
      const end = p ? toMin(p.ends) : 0;
      return { e, p, start, end, done: end !== 0 && now > end, active: end !== 0 && start <= now && now <= end };
    })
    .sort((a, b) => a.start - b.start);

  if (today.dayOfWeek === 0 || rows.length === 0) {
    return <p className="strip-empty" style={{ padding: "10px 16px" }}>No classes scheduled today.</p>;
  }

  const firstPending = rows.findIndex((r) => !r.done);

  return (
    <div className="cw-tl">
      {rows.map((r, i) => (
        <div key={r.e.id}>
          {i === firstPending && firstPending > 0 && !r.active ? (
            <div className="cw-nowline" aria-hidden="true">
              <span className="d" />
              <span className="t">{fmt(now)}</span>
              <span className="l" />
            </div>
          ) : null}
          <div className="cw-tl-row">
            <div className="cw-tl-time">{r.p ? r.p.starts : "—"}</div>
            <div className="cw-tl-body">
              <div className={`cw-slot${r.active ? " now" : r.done ? " done" : ""}`}>
                <div className="cw-slot-t">{r.e.subjectName}</div>
                <div className="cw-slot-s">
                  {r.e.className} · Sec {r.e.sectionName}
                  {r.e.room ? ` · ${r.e.room}` : ""}
                </div>
                {r.active ? (
                  <span className="tag">now</span>
                ) : markedPeriodNos?.has(r.e.periodNo) ? (
                  <span className="tag">marked</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
