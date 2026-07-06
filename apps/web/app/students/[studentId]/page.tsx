"use client";

import { use, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type Session,
  type StudentPerformance,
} from "@/ui/api";
import { Masthead } from "@/ui/Masthead";
import { Sparkline, StatTile, SubjectBars } from "@/ui/charts";

export const dynamic = "force-dynamic";

type LoadState =
  | { state: "loading" }
  | { state: "ok"; data: StudentPerformance }
  | { state: "forbidden" }
  | { state: "not-found" }
  | { state: "error" };

export default function StudentPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params);
  const year = useMemo(() => currentAcademicYear(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [load, setLoad] = useState<LoadState>({ state: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.session();
        if (alive) setSession(me);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          window.location.href = "/login";
        }
        return;
      }
      try {
        const data = await api.studentPerformance(studentId, year);
        if (alive) setLoad({ state: "ok", data });
      } catch (caught) {
        if (!alive) return;
        if (caught instanceof ApiError && caught.status === 403) setLoad({ state: "forbidden" });
        else if (caught instanceof ApiError && caught.status === 404) setLoad({ state: "not-found" });
        else setLoad({ state: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentId, year]);

  return (
    <>
      <Masthead who={session?.displayName} year={year} />
      <main id="main" className="page">
        <a className="linklike" href="/dashboard">
          ← Back to the register
        </a>
        {load.state === "loading" ? <p className="page-lede" style={{ marginTop: 20 }}>Loading…</p> : null}

        {load.state === "forbidden" ? (
          <div className="state" style={{ marginTop: 24 }}>
            <strong>Outside your scope.</strong> None of this student's records fall within the
            classes or subjects you can see.
          </div>
        ) : null}
        {load.state === "not-found" ? (
          <div className="state" style={{ marginTop: 24 }}>
            <strong>No such student.</strong> This record may have been removed.
          </div>
        ) : null}
        {load.state === "error" ? (
          <div className="state" style={{ marginTop: 24 }}>
            Something went wrong. Try again shortly.
          </div>
        ) : null}

        {load.state === "ok" ? <StudentBody data={load.data} /> : null}
      </main>
    </>
  );
}

function StudentBody({ data }: { data: StudentPerformance }) {
  return (
    <>
      <p className="eyebrow" style={{ marginTop: 18 }}>
        Student performance
      </p>
      <h1 className="page-title">{data.name}</h1>
      <p className="page-lede">
        Computed from exactly the attendance and marks you're permitted to read. The overall figure
        appears only when you can see every subject.
      </p>

      <div className="card" style={{ marginBottom: 28 }}>
        <div className="stats">
          {data.attendance !== null ? (
            <StatTile
              value={`${data.attendance.pct}%`}
              label="Attendance (YTD)"
              sub={`${data.attendance.total} sessions`}
            />
          ) : (
            <StatTile value="—" label="Attendance not in your scope" muted />
          )}
          {data.overallPct !== null ? (
            <StatTile value={`${data.overallPct}%`} label="Overall marks (YTD)" />
          ) : (
            <StatTile value="—" label="Overall hidden (you can't see every subject)" muted />
          )}
        </div>
        {data.attendance !== null && data.attendance.monthly.length > 0 ? (
          <div style={{ marginTop: 18, maxWidth: 320 }}>
            <div className="tile-kind" style={{ marginBottom: 6 }}>
              Attendance trend
            </div>
            <Sparkline
              label="Monthly attendance"
              points={data.attendance.monthly.map((point) => ({ x: point.month, y: point.pct }))}
            />
          </div>
        ) : null}
      </div>

      <section className="section" aria-label="Marks by subject">
        <div className="section-head">
          <h2>By subject</h2>
          <span className="stat-sub num">{data.subjects.length} visible</span>
        </div>
        {data.subjects.length === 0 ? (
          <div className="state">
            <strong>No subject marks visible.</strong> You may still see attendance above, but no
            subject in your scope has marks for this student yet.
          </div>
        ) : (
          <>
            <SubjectBars
              rows={data.subjects.map((subject, index) => ({
                label: subject.name,
                value: subject.avgPct,
                index,
              }))}
            />
            <div className="grid" style={{ marginTop: 22 }}>
              {data.subjects.map((subject) => (
                <div className="card" key={subject.subjectId}>
                  <div className="tile-head">
                    <div className="tile-name" style={{ fontSize: 17 }}>
                      {subject.name}
                    </div>
                    <span className="num" style={{ fontSize: 18 }}>
                      {subject.avgPct}%
                    </span>
                  </div>
                  <Sparkline
                    label={`${subject.name} assessments`}
                    points={subject.series.map((point) => ({ x: point.label, y: point.pct }))}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
