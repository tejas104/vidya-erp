"use client";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type PortalAttendance,
  type PortalMarks,
  type PortalMe,
  type TtEntry,
  type TtPeriod,
} from "@/ui/api";
import { PageHeader } from "@/ui/PageHeader";
import { Card } from "@/ui/Card";
import { Badge } from "@/ui/Badge";
import { StatTile, Sparkline, SubjectBars, TrendLine } from "@/ui/charts";
import { DataTable, type Column } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

type Load =
  | { state: "loading" }
  | { state: "unlinked" }
  | { state: "error" }
  | {
      state: "ok";
      me: PortalMe;
      attendance: PortalAttendance;
      marks: PortalMarks;
      timetable: { periods: TtPeriod[]; entries: TtEntry[] };
      today: { dayOfWeek: number; periods: TtPeriod[]; entries: TtEntry[] };
    };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_TONE: Record<string, "good" | "warn" | "danger"> = {
  present: "good",
  late: "warn",
  absent: "danger",
  excused: "warn",
};

export default function PortalPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.portalMe();
        const [attendance, marks, timetable, today] = await Promise.all([
          api.portalAttendance(year),
          api.portalMarks(year),
          api.portalTimetable(year).catch(() => ({ periods: [], entries: [] })),
          api.portalToday(year).catch(() => ({ dayOfWeek: 0, periods: [], entries: [] })),
        ]);
        if (alive) setLoad({ state: "ok", me, attendance, marks, timetable, today });
      } catch (caught) {
        if (!alive) return;
        if (caught instanceof ApiError && caught.status === 404) setLoad({ state: "unlinked" });
        else setLoad({ state: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [year]);

  if (load.state === "loading") return <Skeleton lines={5} />;
  if (load.state === "unlinked") {
    return (
      <EmptyState
        title="Your sign-in isn't linked to a student record yet."
        message="Ask the office to link your account — then your attendance and marks appear here."
      />
    );
  }
  if (load.state === "error") return <EmptyState title="Couldn't load your register." message="Try again shortly." />;

  const { me, attendance, marks, timetable, today } = load;
  const gridCell = (day: number, periodNo: number) =>
    timetable.entries.find((entry) => entry.dayOfWeek === day && entry.periodNo === periodNo);
  const sessionColumns: Column<PortalAttendance["sessions"][number]>[] = [
    { key: "heldOn", header: "Date", render: (row) => <span className="num">{row.heldOn}</span> },
    { key: "status", header: "Status", render: (row) => <Badge tone={STATUS_TONE[row.status] ?? "warn"}>{row.status}</Badge> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="My register"
        title={`Hello, ${me.student.fullName.split(" ")[0]}.`}
        lede={
          me.enrollment
            ? `${me.enrollment.className} · Section ${me.enrollment.sectionName} · AY ${me.enrollment.academicYear} · ${me.student.admissionNo}`
            : `Admission no. ${me.student.admissionNo} — not enrolled this year.`
        }
      />

      <section className="stats" aria-label="My figures" style={{ marginBottom: "var(--space-5)" }}>
        <StatTile
          value={attendance.pct === null ? "—" : `${attendance.pct}%`}
          label="My attendance (YTD)"
          sub={`${attendance.counts.present + attendance.counts.late + attendance.counts.absent + attendance.counts.excused} sessions`}
          muted={attendance.pct === null}
        />
        <StatTile
          value={marks.overallPct === null ? "—" : `${marks.overallPct}%`}
          label="My overall marks (YTD)"
          muted={marks.overallPct === null}
        />
        <StatTile value={String(attendance.counts.absent)} label="Days absent" />
      </section>

      {today.entries.length > 0 ? (
        <section className="section" aria-label="Today's classes">
          <div className="section-head"><h2>Today</h2></div>
          <Card>
            {today.entries.map((entry) => {
              const period = today.periods.find((p) => p.periodNo === entry.periodNo);
              return (
                <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--rule)", fontSize: 14 }}>
                  <span>
                    <span className="num" style={{ marginRight: 10 }}>
                      P{entry.periodNo}{period ? ` · ${period.starts}–${period.ends}` : ""}
                    </span>
                    <strong>{entry.subjectName}</strong>
                  </span>
                  <span style={{ opacity: 0.7 }}>
                    {entry.teacherName}
                    {entry.room !== "" ? ` · ${entry.room}` : ""}
                  </span>
                </div>
              );
            })}
          </Card>
        </section>
      ) : null}

      {timetable.entries.length > 0 ? (
        <section className="section" aria-label="My timetable">
          <div className="section-head"><h2>My timetable</h2></div>
          <div className="ui-tablewrap">
            <table className="ui-table" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  {DAYS.map((day) => (<th key={day} scope="col">{day}</th>))}
                </tr>
              </thead>
              <tbody>
                {timetable.periods.map((period) => (
                  <tr key={period.periodNo}>
                    <td>
                      <strong>P{period.periodNo}</strong>{" "}
                      <span className="num" style={{ opacity: 0.6, fontSize: 12 }}>{period.starts}–{period.ends}</span>
                    </td>
                    {DAYS.map((_, index) => {
                      const entry = gridCell(index + 1, period.periodNo);
                      return (
                        <td key={index} style={{ fontSize: 12.5 }}>
                          {entry ? (
                            <>
                              <strong>{entry.subjectName}</strong>
                              <br />
                              <span style={{ opacity: 0.7 }}>{entry.teacherName}{entry.room !== "" ? ` · ${entry.room}` : ""}</span>
                            </>
                          ) : (
                            <span style={{ opacity: 0.3 }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {attendance.monthly.length > 0 ? (
        <section className="section" aria-label="Attendance trend">
          <div className="section-head"><h2>Attendance by month</h2></div>
          <Card>
            <TrendLine label="My monthly attendance" points={attendance.monthly.map((m) => ({ x: m.month, y: m.pct }))} />
          </Card>
        </section>
      ) : null}

      <section className="section" aria-label="Marks by subject">
        <div className="section-head">
          <h2>My marks</h2>
          <span className="stat-sub num">{marks.subjects.length} subjects</span>
        </div>
        {marks.subjects.length === 0 ? (
          <EmptyState title="No marks yet." message="Scores appear here as your teachers enter them." />
        ) : (
          <>
            <Card>
              <SubjectBars
                rows={marks.subjects.map((subject, index) => ({ label: subject.name, value: subject.avgPct, index }))}
              />
            </Card>
            <div className="grid" style={{ marginTop: "var(--space-4)" }}>
              {marks.subjects.map((subject) => (
                <Card key={subject.subjectId} title={`${subject.name} · ${subject.avgPct}%`}>
                  <Sparkline
                    label={`${subject.name} assessments`}
                    points={subject.marks.map((mark) => ({ x: mark.assessmentName, y: mark.pct }))}
                  />
                  <div style={{ marginTop: "var(--space-2)", display: "grid", gap: 4 }}>
                    {subject.marks.map((mark, index) => (
                      <div key={index} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                        <span>{mark.assessmentName} <span style={{ opacity: 0.55 }}>({mark.kind})</span></span>
                        <span className="num">{mark.pct}%</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="section" aria-label="Recent sessions">
        <div className="section-head"><h2>Recent attendance</h2></div>
        <DataTable
          columns={sessionColumns}
          rows={attendance.sessions}
          rowKey={(row) => row.heldOn + row.status}
          empty={{ title: "No sessions recorded yet." }}
        />
      </section>
    </>
  );
}
