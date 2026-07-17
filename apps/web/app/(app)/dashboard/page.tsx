"use client";

import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type AtRiskEntry,
  type ComparisonReport,
  type Dashboard,
  type DistributionResponse,
  type NodeRollup,
  type NoticeKind,
  type NoticeView,
  type Session,
  type Tile,
  type TtToday,
} from "@/ui/api";
import { Card } from "@/ui/Card";
import { PageHeader } from "@/ui/PageHeader";
import { Noticeboard } from "@/ui/Noticeboard";
import {
  AttendanceSlot,
  CompareBars,
  Histogram,
  MarksSlot,
  RegisterStrip,
  RiskDonut,
  StatTile,
  SubjectBars,
  TrendLine,
} from "@/ui/charts";

export const dynamic = "force-dynamic";

type Focus = { level: "college" | "department" | "class"; nodeId: string; classId?: string; tile: Tile };

const PRECEDENCE: Record<Tile["type"], number> = {
  college: 4,
  department: 3,
  class: 2,
  "teacher-class": 1,
};

function focusOf(tiles: Tile[]): Focus | null {
  if (tiles.length === 0) return null;
  const tile = [...tiles].sort((a, b) => PRECEDENCE[b.type] - PRECEDENCE[a.type])[0]!;
  switch (tile.type) {
    case "college":
      return { level: "college", nodeId: tile.collegeId, tile };
    case "department":
      return { level: "department", nodeId: tile.departmentId, tile };
    case "class":
      return { level: "class", nodeId: tile.classId, classId: tile.classId, tile };
    case "teacher-class":
      return { level: "class", nodeId: tile.classId, classId: tile.classId, tile };
  }
}

function riskSegments(entries: AtRiskEntry[]): { label: string; value: number; tone: string }[] {
  let attOnly = 0;
  let marksOnly = 0;
  let both = 0;
  for (const entry of entries) {
    const a = entry.reasons.includes("low-attendance");
    const m = entry.reasons.includes("low-marks");
    if (a && m) both += 1;
    else if (a) attOnly += 1;
    else if (m) marksOnly += 1;
  }
  return [
    { label: "low attendance", value: attOnly, tone: "var(--series-1)" },
    { label: "low marks", value: marksOnly, tone: "var(--series-2)" },
    { label: "both", value: both, tone: "var(--series-5)" },
  ];
}

// --- teacher dashboard (next-class command card) ---
const KIND_TONE: Record<NoticeKind, string> = {
  holiday: "var(--good)",
  exam: "var(--bad)",
  event: "var(--brand)",
  notice: "var(--ink-3)",
};
const KIND_SOFT: Record<NoticeKind, string> = {
  holiday: "var(--good-soft)",
  exam: "var(--bad-soft)",
  event: "var(--brand-soft)",
  notice: "var(--surface-2)",
};

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

type TtEntry = TtToday["entries"][number];
interface DaySlot { entry: TtEntry; starts: string | null; startMin: number | null; endMin: number | null; }

/** Splits today's periods into the one to feature (ongoing, else next up) and the rest. */
function splitDay(today: TtToday | null, now: Date): { featured: DaySlot | null; rest: DaySlot[]; nowMin: number } {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (today === null || today.dayOfWeek === 0 || today.entries.length === 0) return { featured: null, rest: [], nowMin };
  const slots: DaySlot[] = today.entries
    .map((entry) => {
      const p = today.periods.find((pp) => pp.periodNo === entry.periodNo);
      return { entry, starts: p ? p.starts : null, startMin: p ? hhmmToMin(p.starts) : null, endMin: p ? hhmmToMin(p.ends) : null };
    })
    .sort((a, b) => a.entry.periodNo - b.entry.periodNo);
  const ongoing = slots.find((s) => s.startMin !== null && s.endMin !== null && s.startMin <= nowMin && nowMin < s.endMin) ?? null;
  const upcoming = slots.filter((s) => s.startMin !== null && s.startMin > nowMin).sort((a, b) => a.startMin! - b.startMin!)[0] ?? null;
  const featured = ongoing ?? upcoming ?? null;
  return { featured, rest: slots.filter((s) => s !== featured), nowMin };
}

function markHref(e: TtEntry): string {
  return `/manage/attendance?sectionId=${encodeURIComponent(e.sectionId)}&subjectId=${encodeURIComponent(e.subjectId)}&slot=${encodeURIComponent(`p${e.periodNo}`)}`;
}

export default function DashboardPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskEntry[]>([]);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [today, setToday] = useState<TtToday | null>(null);
  const [notices, setNotices] = useState<NoticeView[] | null>(null);
  const [leaveWaiting, setLeaveWaiting] = useState<number | null>(null);
  const [rollup, setRollup] = useState<NodeRollup | null>(null);
  const [compare, setCompare] = useState<ComparisonReport | null>(null);
  const [distribution, setDistribution] = useState<DistributionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.session();
        if (!alive) return;
        // A pure student sign-in lives in the portal, not the staff register.
        if (me.roles.length > 0 && me.roles.every((role) => role === "student")) {
          window.location.replace("/portal");
          return;
        }
        // --- fees: a pure accountant sign-in lives at the counter, not the staff register ---
        if (me.roles.length > 0 && me.roles.every((role) => role === "accountant")) {
          window.location.replace("/manage/fees");
          return;
        }
        setSession(me);
        // --- timetable: the teaching roles get a Today card + compact notices ---
        if (me.roles.includes("teacher") || me.roles.includes("class_teacher")) {
          api.ttMyToday(year).then((t) => {
            if (alive) setToday(t);
          }).catch(() => undefined);
          api.ntcVisible().then((r) => {
            if (alive) setNotices(r.notices);
          }).catch(() => undefined);
        }
        // --- leave: approvers get a "waiting" card ---
        if (me.roles.includes("hod") || me.roles.includes("admin")) {
          api.lvsPending().then((r) => {
            if (alive) setLeaveWaiting(r.requests.length);
          }).catch(() => undefined);
        }
        const dash = await api.dashboard(year);
        if (!alive) return;
        setDashboard(dash);

        const seen = new Map<string, AtRiskEntry>();
        for (const tile of dash.tiles) {
          const level =
            tile.type === "department" ? "department" : tile.type === "college" ? "college" : "class";
          const nodeId =
            tile.type === "department" ? tile.departmentId : tile.type === "college" ? tile.collegeId : tile.classId;
          try {
            const result = await api.atRisk(level, nodeId, year);
            for (const entry of result.students) if (!seen.has(entry.studentId)) seen.set(entry.studentId, entry);
          } catch {
            /* a node the caller cannot enumerate is skipped */
          }
        }
        if (alive) {
          setAtRisk([...seen.values()].sort((a, b) => (a.attendancePct ?? 100) - (b.attendancePct ?? 100)));
        }

        const f = focusOf(dash.tiles);
        if (alive) setFocus(f);
        if (f) {
          try {
            if (alive) setRollup(await api.rollup(f.level, f.nodeId, year));
          } catch {
            /* rollup optional */
          }
          try {
            if (alive) setCompare(await api.compare(f.level, f.nodeId, year));
          } catch {
            /* comparison optional */
          }
          if (f.classId) {
            try {
              if (alive) setDistribution(await api.distribution("class", f.classId, year));
            } catch {
              /* distribution optional */
            }
          }
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (alive) setError("Something went wrong loading your dashboard. Try again shortly.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [year]);

  if (error !== null) {
    return <div className="state">{error}</div>;
  }
  if (dashboard === null || session === null) {
    return <p className="page-lede">Opening the register…</p>;
  }

  const focusTile = focus?.tile ?? null;
  const kpiAttendance = focusTile && "attendance" in focusTile ? focusTile.attendance : null;
  const kpiMarks = focusTile && "marks" in focusTile ? focusTile.marks : null;
  const cohort =
    kpiAttendance && kpiAttendance.state === "ok" ? kpiAttendance.value.distinctStudents : null;

  // Teaching-only staff get the focused "a teacher's day" dashboard; oversight
  // roles (hod/principal/admin) keep the analytics dashboard below.
  const teachingOnly =
    session.roles.length > 0 &&
    session.roles.some((r) => r === "teacher" || r === "class_teacher") &&
    !session.roles.some((r) => r === "admin" || r === "principal" || r === "hod");

  if (teachingOnly) {
    const day = splitDay(today, new Date());
    const featured = day.featured;
    const inMin = featured && featured.startMin !== null ? featured.startMin - day.nowMin : null;
    return (
      <>
        <PageHeader
          eyebrow={session.roles.join(" · ")}
          title={`Good day, ${session.displayName.split(" ")[0]}.`}
          lede="Your day — the class in front of you first. Every figure is drawn only from records you may read."
        />

        {featured ? (
          <section className="td-cmd td-depth" aria-label="Next class">
            <div className="td-cmd-time">
              <div className="td-cmd-clock">{featured.starts ?? "—"}</div>
              {featured.entry.room !== "" ? <div className="td-cmd-room">Room {featured.entry.room}</div> : null}
            </div>
            <div className="td-cmd-main">
              <span className="td-cmd-eyebrow">
                <span className="td-pulse" aria-hidden="true" /> {inMin !== null && inMin > 0 ? `Next class · in ${inMin} min` : "In session now"}
              </span>
              <h2>{featured.entry.subjectName}</h2>
              <p className="td-cmd-where">{featured.entry.className} · Sec {featured.entry.sectionName}</p>
            </div>
            <div className="td-cmd-actions">
              <a className="btn" href={markHref(featured.entry)}>Mark attendance</a>
            </div>
          </section>
        ) : (
          <section className="td-cmd td-depth" aria-label="Today">
            <div className="td-cmd-main">
              <span className="td-cmd-eyebrow">Today</span>
              <h2>{today === null || today.entries.length === 0 ? "No classes scheduled today" : "No more classes today"}</h2>
              <p className="td-cmd-where">Check who needs attention below.</p>
            </div>
          </section>
        )}

        <div className="td-cols td-depth">
          <div className="td-col">
            <section className="td-panel">
              <div className="td-head">
                <h2>Rest of today</h2>
                {today !== null ? <span className="count">{today.entries.length} period{today.entries.length === 1 ? "" : "s"}</span> : null}
              </div>
              <div className="td-body">
                {day.rest.length === 0 ? (
                  <p className="strip-empty">Nothing else on the timetable today.</p>
                ) : (
                  day.rest.map((s) => {
                    const ended = s.endMin !== null && s.endMin <= day.nowMin;
                    return (
                      <div key={s.entry.id} className={`td-rest${ended ? " ended" : ""}`}>
                        <div className="t"><div className="p">P{s.entry.periodNo}</div><div className="h">{s.starts ?? "—"}</div></div>
                        <div>
                          <div className="subj">{s.entry.subjectName}</div>
                          <div className="where">{s.entry.className} · Sec {s.entry.sectionName}{s.entry.room !== "" ? ` · ${s.entry.room}` : ""}</div>
                        </div>
                        <a className="btn ghost" href={markHref(s.entry)}>Mark</a>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="td-panel">
              <div className="td-head">
                <h2>Needs attention</h2>
                <span className="count">{atRisk.length} flagged</span>
              </div>
              <div className="td-body tight">
                {atRisk.length === 0 ? (
                  <p className="strip-empty" style={{ padding: "6px 4px 10px" }}>No one is flagged — attendance and marks are above the thresholds.</p>
                ) : (
                  atRisk.map((entry) => (
                    <div className="risk-row" key={entry.studentId}>
                      <div>
                        <a className="risk-name" href={`/students/${encodeURIComponent(entry.studentId)}`}>{entry.name}</a>
                        <div className="risk-reasons" style={{ marginTop: 6 }}>
                          {entry.reasons.includes("low-attendance") ? <span className="chip serious">low attendance</span> : null}
                          {entry.reasons.includes("low-marks") ? <span className="chip serious">low marks</span> : null}
                        </div>
                      </div>
                      <div className="risk-figs">
                        {entry.attendancePct !== null ? (<span><span className="k">attend</span>{entry.attendancePct}%</span>) : null}
                        {entry.overallPct !== null ? (<span><span className="k">overall</span>{entry.overallPct}%</span>) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="td-col">
            <div className="td-strip">
              <div className="td-stat good">
                <div className="v">{kpiAttendance && kpiAttendance.state === "ok" ? `${kpiAttendance.value.pct}%` : "—"}</div>
                <div className="l">Attendance</div>
              </div>
              <div className="td-stat">
                <div className="v">{cohort === null ? "—" : cohort}</div>
                <div className="l">Students</div>
              </div>
              <div className="td-stat risk">
                <div className="v">{atRisk.length}</div>
                <div className="l">At risk</div>
              </div>
            </div>

            {atRisk.length > 0 ? (
              <section className="td-panel">
                <div className="td-head"><h2>Risk composition</h2></div>
                <div className="td-body" style={{ paddingLeft: 18, paddingRight: 18, paddingBottom: 18 }}>
                  <RiskDonut label="At-risk composition" total={atRisk.length} segments={riskSegments(atRisk)} />
                </div>
              </section>
            ) : null}

            <section className="td-panel">
              <div className="td-head">
                <h2>Notices</h2>
                {notices !== null ? <span className="count">{notices.length}</span> : null}
              </div>
              <div className="td-body">
                {notices === null ? (
                  <p className="strip-empty">Loading…</p>
                ) : notices.length === 0 ? (
                  <p className="strip-empty">Nothing on the board.</p>
                ) : (
                  notices.slice(0, 5).map((n) => (
                    <div key={n.id} className="td-notice">
                      <span className="dot" style={{ borderColor: KIND_TONE[n.kind], background: KIND_SOFT[n.kind] }} aria-hidden="true" />
                      <div>
                        <div className="t">{n.title}</div>
                        <div className="m">{n.kind} · {n.audienceLabel} · <span className="num" style={{ textTransform: "none" }}>{n.publishAt.slice(0, 10)}</span></div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={session.roles.join(" · ")}
        title={`Good day, ${session.displayName.split(" ")[0]}.`}
        lede="Every figure here is drawn only from records you're allowed to read. Rooms outside your scope simply don't appear."
      />

      {/* --- notices --- */}
      <Noticeboard />

      {/* --- leave: waiting-on-you card --- */}
      {leaveWaiting !== null && leaveWaiting > 0 ? (
        <section className="section" aria-label="Leave approvals" style={{ marginTop: 0 }}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <strong>{leaveWaiting} leave request{leaveWaiting === 1 ? "" : "s"} waiting</strong>
              <a className="btn ghost" href="/manage/leave">Review</a>
            </div>
          </Card>
        </section>
      ) : null}

        {dashboard.tiles.length === 0 ? (
          <div className="state">
            <strong>Nothing to show yet.</strong> Once an administrator assigns you a class, subject or area,
            your register appears here.
          </div>
        ) : (
          <>
            {/* TODAY (teaching roles, from the timetable) */}
            {today !== null ? (
              <section className="section" aria-label="Today's schedule" style={{ marginTop: 0 }}>
                <div className="section-head">
                  <h2>Today</h2>
                  <span className="stat-sub num">{today.entries.length} period{today.entries.length === 1 ? "" : "s"}</span>
                </div>
                <div className="card">
                  {today.dayOfWeek === 0 || today.entries.length === 0 ? (
                    <p className="strip-empty">No classes scheduled today.</p>
                  ) : (
                    today.entries.map((entry) => {
                      const period = today.periods.find((p) => p.periodNo === entry.periodNo);
                      return (
                        <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "9px 0", borderTop: "1px solid var(--rule)" }}>
                          <span>
                            <span className="num" style={{ marginRight: 10 }}>
                              P{entry.periodNo}{period ? ` · ${period.starts}–${period.ends}` : ""}
                            </span>
                            <strong>{entry.subjectName}</strong>{" "}
                            <span style={{ opacity: 0.7 }}>
                              {entry.className} · Sec {entry.sectionName}
                              {entry.room !== "" ? ` · ${entry.room}` : ""}
                            </span>
                          </span>
                          {session.roles.includes("teacher") || session.roles.includes("class_teacher") ? (
                            <a
                              className="btn ghost"
                              href={`/manage/attendance?sectionId=${encodeURIComponent(entry.sectionId)}&subjectId=${encodeURIComponent(entry.subjectId)}&slot=${encodeURIComponent(`p${entry.periodNo}`)}`}
                            >
                              Open · mark attendance
                            </a>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            ) : null}

            {/* KPI ROW */}
            <section className="stats" aria-label="Key figures" style={{ marginBottom: 24 }}>
              {kpiAttendance ? <AttendanceSlot slot={kpiAttendance} /> : null}
              {kpiMarks ? <MarksSlot slot={kpiMarks} /> : null}
              <StatTile value={String(atRisk.length)} label="Students at risk" />
              <StatTile value={cohort === null ? "—" : String(cohort)} label="Students in scope" muted={cohort === null} />
            </section>

            {/* ATTENDANCE TREND */}
            {kpiAttendance && kpiAttendance.state === "ok" && kpiAttendance.value.monthly.length > 0 ? (
              <section className="section" aria-label="Attendance trend">
                <div className="section-head"><h2>Attendance trend</h2></div>
                <div className="card">
                  <TrendLine
                    label="Monthly attendance"
                    points={kpiAttendance.value.monthly.map((m) => ({ x: m.month, y: m.pct }))}
                  />
                </div>
              </section>
            ) : null}

            {/* MARKS BY SUBJECT */}
            {rollup && rollup.marks.bySubject.length > 0 ? (
              <section className="section" aria-label="Marks by subject">
                <div className="section-head">
                  <h2>Marks by subject</h2>
                  <span className="stat-sub num">{rollup.marks.bySubject.length} visible</span>
                </div>
                <div className="card">
                  <SubjectBars
                    rows={rollup.marks.bySubject.map((s, index) => ({
                      label: s.name,
                      value: s.summary.state === "ok" ? s.summary.value.avgPct : 0,
                      index,
                    }))}
                  />
                </div>
              </section>
            ) : null}

            {/* COMPARISON */}
            {compare && compare.children.length > 0 ? (
              <section className="section" aria-label="Comparison">
                <div className="section-head">
                  <h2>Comparison — {compare.childLevel === "department" ? "departments" : compare.childLevel === "class" ? "classes" : "sections"}</h2>
                </div>
                <div className="card">
                  <CompareBars
                    rows={compare.children.map((child) => ({
                      label: child.name,
                      attendancePct: child.attendance.state === "ok" ? child.attendance.value.pct : null,
                      marksPct: child.marks.state === "ok" ? child.marks.value.avgPct : null,
                      atRisk: child.atRisk,
                    }))}
                  />
                </div>
              </section>
            ) : null}

            {/* MARKS DISTRIBUTION */}
            {distribution ? (
              <section className="section" aria-label="Marks distribution">
                <div className="section-head"><h2>Marks distribution</h2></div>
                <div className="card">
                  {distribution.marks.state === "ok" ? (
                    <Histogram label="Overall marks distribution" bands={distribution.marks.value.bands} />
                  ) : (
                    <div className="strip-empty">
                      {distribution.marks.state === "insufficient-cohort"
                        ? `Cohort too small to summarise (under ${distribution.marks.minCohort}).`
                        : "No distribution yet."}
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {/* AT-RISK DONUT */}
            {atRisk.length > 0 ? (
              <section className="section" aria-label="At-risk composition">
                <div className="section-head"><h2>Risk composition</h2></div>
                <div className="card">
                  <RiskDonut label="At-risk composition" total={atRisk.length} segments={riskSegments(atRisk)} />
                </div>
              </section>
            ) : null}

            {/* REGISTER STRIP */}
            {focusTile && (focusTile.type === "class" || focusTile.type === "teacher-class") && focusTile.strip.length > 0 ? (
              <section className="section" aria-label="Register">
                <div className="section-head"><h2>The register</h2></div>
                <div className="card"><RegisterStrip sections={focusTile.strip} /></div>
              </section>
            ) : null}
          </>
        )}

        {/* NEEDS ATTENTION */}
        <section className="section" aria-label="Students who need attention">
          <div className="section-head">
            <h2>Needs attention</h2>
            <span className="stat-sub num">{atRisk.length} flagged</span>
          </div>
          {atRisk.length === 0 ? (
            <div className="state">
              <strong>No one is flagged.</strong> Students appear here when attendance or marks fall below the
              thresholds — nothing to chase right now.
            </div>
          ) : (
            <div className="card">
              {atRisk.map((entry) => (
                <div className="risk-row" key={entry.studentId}>
                  <div>
                    <a className="risk-name" href={`/students/${encodeURIComponent(entry.studentId)}`}>{entry.name}</a>
                    <div className="risk-reasons" style={{ marginTop: 6 }}>
                      {entry.reasons.includes("low-attendance") ? <span className="chip serious">low attendance</span> : null}
                      {entry.reasons.includes("low-marks") ? <span className="chip serious">low marks</span> : null}
                    </div>
                  </div>
                  <div className="risk-figs">
                    {entry.attendancePct !== null ? (<span><span className="k">attend</span>{entry.attendancePct}%</span>) : null}
                    {entry.overallPct !== null ? (<span><span className="k">overall</span>{entry.overallPct}%</span>) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
    </>
  );
}
