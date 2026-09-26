"use client";

import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type ComparisonReport,
  type Dashboard,
  type DistributionResponse,
  type NodeRollup,
  type Session,
  type SchoolTermView,
} from "@/ui/api";
import { Button, PageHeader } from "@vidya/ui-system";
import { AttendanceColumns, CompareBars, Histogram, PieBreakdown, RegisterStrip, SubjectBars, TrendLine } from "@/ui/charts";
import { focusOf, type Focus } from "@/ui/oversightFocus";
import { HelpButton } from "@/ui/help/HelpButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type TrendView = "columns" | "line" | "area" | "data";
const TREND_VIEWS: { value: TrendView; label: string }[] = [
  { value: "columns", label: "Columns" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "data", label: "Data" },
];

function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) return month;
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date(Number(match[1]), index, 1));
}

function decimal(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);
}

function percent(value: number): string {
  return `${decimal(value)}%`;
}

// The real ANALYTICS screen (nav entry: navConfig.ts). Everything below used
// to live inline on /dashboard for oversight roles — split out so the nav
// item can actually highlight when active (a redirect alias never can: the
// browser lands on /dashboard and "Dashboard" lights up instead). /dashboard
// keeps the at-a-glance KPIs, at-risk composition and the actionable "Needs
// attention" list; this screen keeps the deeper trend/comparison/distribution
// views, which need their own rollup/compare/distribution fetches anyway.
// `focusOf` (which node the caller is currently focused on) is shared with
// /dashboard via @/ui/oversightFocus rather than duplicated.
export default function AnalyticsPage() {
  const currentYear = useMemo(() => currentAcademicYear(), []);
  const [year, setYear] = useState(currentYear);
  const [terms, setTerms] = useState<SchoolTermView[] | null>(null);
  const [classes, setClasses] = useState<{ id: string; label: string }[]>([]);
  const [classId, setClassId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [rollup, setRollup] = useState<NodeRollup | null>(null);
  const [compare, setCompare] = useState<ComparisonReport | null>(null);
  const [distribution, setDistribution] = useState<DistributionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [recomputing, setRecomputing] = useState(false);
  const [trendView, setTrendView] = useState<TrendView>("columns");

  async function handleRecompute() {
    setRecomputing(true);
    try {
      await api.recomputeAnalytics(year);
      setReloadKey((k) => k + 1);
    } catch {
      setError("Couldn't start the analytics rebuild. Try again shortly.");
    } finally {
      setRecomputing(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setDashboard(null); setRollup(null); setCompare(null); setDistribution(null); setTerms(null); setError(null);
    (async () => {
      try {
        const me = await api.session();
        if (!alive) return;
        setSession(me);
        void api.schoolTerms(year).then(({ terms: rows }) => { if (alive) setTerms(rows); }).catch(() => { if (alive) setTerms([]); });
        if (me.roles.includes("admin") || me.roles.includes("principal")) void api.colleges().then(async ({ colleges }) => {
          if (!colleges[0]) return;
          const tree = await api.collegeTree(colleges[0].id);
          if (!alive) return;
          const options = tree.departments.flatMap((department) => department.classes.map((klass) => ({ id: klass.id, label: klass.name })));
          setClasses(options);
          setClassId((current) => options.some((option) => option.id === current) ? current : options[0]?.id ?? "");
        }).catch(() => { if (alive) setClasses([]); });

        const dash = await api.dashboard(year);
        if (!alive) return;
        setDashboard(dash);

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
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (alive) setError("Something went wrong loading analytics. Try again shortly.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [year, reloadKey]);

  useEffect(() => {
    const scopedClassId = classId || focus?.classId;
    if (!scopedClassId) return;
    let alive = true;
    setDistribution(null);
    void api.distribution("class", scopedClassId, year).then((result) => {
      if (alive) setDistribution(result);
    }).catch(() => { if (alive) setDistribution(null); });
    return () => { alive = false; };
  }, [classId, focus?.classId, year, reloadKey]);

  if (error !== null) {
    return <div className="state">{error}</div>;
  }
  if (dashboard === null || session === null) {
    return <p className="page-lede">Opening analytics…</p>;
  }

  const focusTile = focus?.tile ?? null;
  const kpiAttendance = focusTile && "attendance" in focusTile ? focusTile.attendance : null;

  const monthly = kpiAttendance !== null && kpiAttendance.state === "ok"
    ? [...kpiAttendance.value.monthly].sort((a, b) => a.month.localeCompare(b.month)) : [];
  const hasTrend = monthly.length > 0;
  const firstMonth = monthly[0];
  const lastMonth = monthly[monthly.length - 1];
  const change = firstMonth && lastMonth ? Math.round((lastMonth.pct - firstMonth.pct) * 10) / 10 : 0;
  const hasSubjects = rollup !== null && rollup.marks.bySubject.length > 0;
  const hasComparison = compare !== null && compare.children.length > 0;
  const hasDistribution = distribution !== null;
  const hasStrip =
    focusTile !== null && (focusTile.type === "class" || focusTile.type === "teacher-class") && focusTile.strip.length > 0;
  const hasContent = hasTrend || hasSubjects || hasComparison || hasDistribution || hasStrip;

  return (
    <>
      <PageHeader
        eyebrow={session.roles.join(" · ")}
        title="Analytics"
        lede="Trends, comparisons and distributions for the areas you oversee — every figure is drawn only from records you're allowed to read."
        help={<HelpButton slug="analytics" />}
        // Rollups are precomputed, so an admin can force a rebuild after a
        // bulk data change. Lives here (not /dashboard) since it directly
        // affects what this screen shows.
        actions={
          session.roles.includes("admin") ? (
            <Button variant="ghost" onClick={() => void handleRecompute()} loading={recomputing}>
              Recompute analytics
            </Button>
          ) : undefined
        }
      />

      <div className={styles.yearPicker}>
        <label htmlFor="analytics-year">Academic year</label>
        <select id="analytics-year" value={year} onChange={(event) => setYear(event.target.value)}>
          {[0, 1, 2, 3].map((offset) => {
            const first = Number(currentYear.slice(0, 4)) - offset;
            const option = `${first}-${String((first + 1) % 100).padStart(2, "0")}`;
            return <option key={option} value={option}>{option}</option>;
          })}
        </select>
        <span>Charts show the full selected academic year. Term dates are listed below.</span>
      </div>

      {terms && terms.length > 0 ? <section className="section" aria-label="School terms">
        <div className="section-head"><h2>School terms</h2><span className="stat-sub num">{terms.length} terms</span></div>
        <div className={styles.terms}>{terms.map((term) => <div className="card" key={term.id}>
          <strong>{term.name}</strong><span>{term.startsOn} to {term.endsOn}</span>
          <span>{term.status === "open" ? "Open" : "Closed"}{term.marksReleasedAt ? " · Marks released" : " · Marks not released"}</span>
        </div>)}</div>
      </section> : null}

      {!hasContent ? (
        <div className="state">
          <strong>Nothing to analyse yet.</strong> Once there's scoped attendance or marks data — or an
          assigned class, subject or department — trends and comparisons appear here.
        </div>
      ) : (
        <>
          {/* ATTENDANCE TREND */}
          {hasTrend ? (
            <section className="section" aria-label="Attendance trend">
              <div className={`section-head ${styles.chartHead}`}>
                <h2>Attendance trend</h2>
                <div className={styles.chartModes} role="group" aria-label="Attendance chart view">
                  {TREND_VIEWS.filter((view) => monthly.length > 1 || view.value === "columns" || view.value === "data").map((view) => (
                    <button key={view.value} type="button" className={styles.chartMode}
                      aria-pressed={trendView === view.value} onClick={() => setTrendView(view.value)}>{view.label}</button>
                  ))}
                </div>
              </div>
              <div className="card">
                <p className={styles.trendSummary}>
                  {lastMonth ? `Latest: ${percent(lastMonth.pct)} in ${monthLabel(lastMonth.month)}.` : ""}
                  {firstMonth && lastMonth && monthly.length > 1 ? ` ${change === 0 ? "No change" : `${change > 0 ? "Up" : "Down"} ${decimal(Math.abs(change))} percentage points`} from ${monthLabel(firstMonth.month)}.` : ""}
                </p>
                {trendView === "columns" || monthly.length === 1 && trendView !== "data" ? (
                  <AttendanceColumns label="Monthly attendance" points={monthly.map((m) => ({ x: m.month, y: m.pct }))} />
                ) : trendView === "line" || trendView === "area" ? (
                  <div className="attendance-chart-scroll">
                    <TrendLine label={`${trendView === "line" ? "Line" : "Area"} chart of monthly attendance`}
                      points={monthly.map((m) => ({ x: monthLabel(m.month), y: m.pct }))}
                      height={190} fillOpacity={trendView === "area" ? 0.26 : 0} />
                  </div>
                ) : (
                  <table className={styles.dataTable} aria-label="Monthly attendance values">
                    <thead><tr><th scope="col">Month</th><th scope="col">Attendance</th></tr></thead>
                    <tbody>{monthly.map((m) => <tr key={m.month}><th scope="row">{monthLabel(m.month)}</th><td>{percent(m.pct)}</td></tr>)}</tbody>
                  </table>
                )}
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

          {/* PRIVACY-GATED DISTRIBUTIONS */}
          {classes.length > 0 ? <div className={styles.yearPicker}>
            <label htmlFor="analytics-class">Distribution class</label>
            <select id="analytics-class" value={classId} onChange={(event) => setClassId(event.target.value)}>
              {classes.map((klass) => <option key={klass.id} value={klass.id}>{klass.label}</option>)}
            </select>
            <span>Only cohorts you are allowed to see are summarized.</span>
          </div> : null}
          {distribution ? (
            <section className="section" aria-label="Student distributions">
              <div className="section-head"><h2>Student distributions</h2></div>
              <div className={styles.distributions}><div className="card"><h3>Marks by band</h3>
                {distribution.marks.state === "ok" ? (
                  <><PieBreakdown label="Marks distribution" bands={distribution.marks.value.bands} /><Histogram label="Overall marks distribution" bands={distribution.marks.value.bands} /></>
                ) : (
                  <div className="strip-empty">
                    {distribution.marks.state === "insufficient-cohort"
                      ? `Cohort too small to summarise (under ${distribution.marks.minCohort}).`
                      : "No distribution yet."}
                  </div>
                )}
              </div><div className="card"><h3>Attendance by band</h3>
                {distribution.attendance.state === "ok" ? <PieBreakdown label="Attendance distribution" bands={distribution.attendance.value.bands} /> :
                  <div className="strip-empty">{distribution.attendance.state === "insufficient-cohort" ? `Cohort too small to summarise (under ${distribution.attendance.minCohort}).` : "No distribution yet."}</div>}
              </div></div>
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
    </>
  );
}
