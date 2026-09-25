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
} from "@/ui/api";
import { Button, PageHeader } from "@vidya/ui-system";
import { AttendanceColumns, CompareBars, Histogram, RegisterStrip, SubjectBars, TrendLine } from "@/ui/charts";
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
  const year = useMemo(() => currentAcademicYear(), []);
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
    (async () => {
      try {
        const me = await api.session();
        if (!alive) return;
        setSession(me);

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
        if (alive) setError("Something went wrong loading analytics. Try again shortly.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [year, reloadKey]);

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
