"use client";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type PortalAttendance,
  type PortalMarks,
  type PortalMe,
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
  | { state: "ok"; me: PortalMe; attendance: PortalAttendance; marks: PortalMarks };

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
        const [attendance, marks] = await Promise.all([api.portalAttendance(year), api.portalMarks(year)]);
        if (alive) setLoad({ state: "ok", me, attendance, marks });
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

  const { me, attendance, marks } = load;
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
