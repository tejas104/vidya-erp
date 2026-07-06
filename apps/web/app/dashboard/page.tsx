"use client";

import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type AtRiskEntry,
  type Dashboard,
  type Session,
  type Tile,
} from "@/ui/api";
import { Masthead } from "@/ui/Masthead";
import {
  AttendanceSlot,
  MarksSlot,
  RegisterStrip,
} from "@/ui/charts";

export const dynamic = "force-dynamic";

function tileNode(tile: Tile): { level: string; nodeId: string } {
  switch (tile.type) {
    case "teacher-class":
    case "class":
      return { level: "class", nodeId: tile.classId };
    case "department":
      return { level: "department", nodeId: tile.departmentId };
    case "college":
      return { level: "college", nodeId: tile.collegeId };
  }
}

function tileKind(tile: Tile): string {
  switch (tile.type) {
    case "teacher-class":
      return "My subject";
    case "class":
      return "My class";
    case "department":
      return "Department";
    case "college":
      return "College";
  }
}

function tileName(tile: Tile, names: Record<string, string>): string {
  const { nodeId } = tileNode(tile);
  const base = names[nodeId] ?? nodeId;
  if (tile.type === "teacher-class") {
    return `${base} · ${names[tile.subjectId] ?? tile.subjectId}`;
  }
  return base;
}

export default function DashboardPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        // Merge at-risk across every node the caller can see (dedupe by student).
        const seen = new Map<string, AtRiskEntry>();
        for (const tile of dash.tiles) {
          const { level, nodeId } = tileNode(tile);
          try {
            const result = await api.atRisk(level, nodeId, year);
            for (const entry of result.students) {
              if (!seen.has(entry.studentId)) {
                seen.set(entry.studentId, entry);
              }
            }
          } catch {
            /* a node the caller cannot enumerate is simply skipped */
          }
        }
        if (alive) {
          setAtRisk(
            [...seen.values()].sort((a, b) => (a.attendancePct ?? 100) - (b.attendancePct ?? 100)),
          );
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
    return (
      <>
        <Masthead year={year} />
        <main id="main" className="page">
          <div className="state">{error}</div>
        </main>
      </>
    );
  }

  if (dashboard === null || session === null) {
    return (
      <>
        <Masthead year={year} />
        <main id="main" className="page">
          <p className="page-lede">Opening the register…</p>
        </main>
      </>
    );
  }

  const names = dashboard.names;

  return (
    <>
      <Masthead who={session.displayName} year={year} />
      <main id="main" className="page">
        <p className="eyebrow">{session.roles.join(" · ")}</p>
        <h1 className="page-title">Good day, {session.displayName.split(" ")[0]}.</h1>
        <p className="page-lede">
          Every figure here is drawn only from records you're allowed to read. Rooms outside your
          scope simply don't appear.
        </p>

        {dashboard.tiles.length === 0 ? (
          <div className="state">
            <strong>Nothing to show yet.</strong> You don't have any classes, subjects or areas
            assigned. Once an administrator assigns you, your register appears here.
          </div>
        ) : (
          <section className="grid" aria-label="Your areas">
            {dashboard.tiles.map((tile, index) => (
              <article className="card reveal" key={`${tile.type}-${tileNode(tile).nodeId}-${index}`}>
                <div className="tile-head">
                  <div>
                    <div className="tile-kind">{tileKind(tile)}</div>
                    <div className="tile-name">{tileName(tile, names)}</div>
                  </div>
                  <span className={`risk-count${tile.atRisk === 0 ? " clear" : ""}`}>
                    <span className="risk-dot" aria-hidden="true" />
                    {tile.atRisk === 0 ? "all on track" : `${tile.atRisk} at risk`}
                  </span>
                </div>
                <div className="stats">
                  <AttendanceSlot slot={tile.attendance} />
                  <MarksSlot slot={tile.marks} />
                </div>
                {(tile.type === "teacher-class" || tile.type === "class") && tile.strip.length > 0 ? (
                  <RegisterStrip sections={tile.strip} />
                ) : null}
              </article>
            ))}
          </section>
        )}

        <section className="section" aria-label="Students who need attention">
          <div className="section-head">
            <h2>Needs attention</h2>
            <span className="stat-sub num">{atRisk.length} flagged</span>
          </div>
          {atRisk.length === 0 ? (
            <div className="state">
              <strong>No one is flagged.</strong> Students appear here when their attendance or
              marks fall below the thresholds — nothing to chase right now.
            </div>
          ) : (
            <div className="card">
              {atRisk.map((entry) => (
                <div className="risk-row" key={entry.studentId}>
                  <div>
                    <a className="risk-name" href={`/students/${encodeURIComponent(entry.studentId)}`}>
                      {entry.name}
                    </a>
                    <div className="risk-reasons" style={{ marginTop: 6 }}>
                      {entry.reasons.includes("low-attendance") ? (
                        <span className="chip serious">low attendance</span>
                      ) : null}
                      {entry.reasons.includes("low-marks") ? (
                        <span className="chip serious">low marks</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="risk-figs">
                    {entry.attendancePct !== null ? (
                      <span>
                        <span className="k">attend</span>
                        {entry.attendancePct}%
                      </span>
                    ) : null}
                    {entry.overallPct !== null ? (
                      <span>
                        <span className="k">overall</span>
                        {entry.overallPct}%
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
