"use client";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type CwkAssignment,
  type CwkMaterial,
  type PortalAttendance,
  type PortalMarks,
  type PortalMe,
  type TtEntry,
  type TtPeriod,
} from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
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
      assignments: CwkAssignment[];
      materials: CwkMaterial[];
    };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_TONE: Record<string, "good" | "warn" | "danger"> = {
  present: "good",
  late: "warn",
  absent: "danger",
  excused: "warn",
};

export default function PortalPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const [submitFor, setSubmitFor] = useState<CwkAssignment | null>(null);
  const [submitText, setSubmitText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitWork() {
    if (!submitFor) return;
    setSubmitting(true);
    try {
      await api.cwkSubmit(submitFor.id, { body: submitText });
      toast.show(`Submitted "${submitFor.title}".`, "good");
      setSubmitFor(null);
      setSubmitText("");
      setReloadTick((t) => t + 1);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't submit.", "danger");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.portalMe();
        const [attendance, marks, timetable, today, cwkA, cwkM] = await Promise.all([
          api.portalAttendance(year),
          api.portalMarks(year),
          api.portalTimetable(year).catch(() => ({ periods: [], entries: [] })),
          api.portalToday(year).catch(() => ({ dayOfWeek: 0, periods: [], entries: [] })),
          api.cwkMyAssignments(year).catch(() => ({ assignments: [] as CwkAssignment[] })),
          api.cwkMyMaterials(year).catch(() => ({ materials: [] as CwkMaterial[] })),
        ]);
        if (alive)
          setLoad({
            state: "ok",
            me,
            attendance,
            marks,
            timetable,
            today,
            assignments: cwkA.assignments,
            materials: cwkM.materials,
          });
      } catch (caught) {
        if (!alive) return;
        if (caught instanceof ApiError && caught.status === 404) setLoad({ state: "unlinked" });
        else setLoad({ state: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [year, reloadTick]);

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

  const { me, attendance, marks, timetable, today, assignments, materials } = load;
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

      <section className="section" aria-label="My assignments">
        <div className="section-head">
          <h2>Assignments</h2>
          <span className="stat-sub num">{assignments.length}</span>
        </div>
        {assignments.length === 0 ? (
          <EmptyState title="No assignments yet." message="Work your teachers assign appears here." />
        ) : (
          <Card>
            {assignments.map((assignment) => (
              <div key={assignment.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 0", borderTop: "1px solid var(--rule)" }}>
                <span>
                  <strong>{assignment.title}</strong>{" "}
                  <span style={{ opacity: 0.65, fontSize: 13 }}>{assignment.subjectName} · due <span className="num">{assignment.dueOn}</span></span>
                </span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  {assignment.mySubmission ? (
                    assignment.mySubmission.score !== null ? (
                      <Badge tone="good">scored {assignment.mySubmission.score}{assignment.maxScore !== null ? `/${assignment.maxScore}` : ""}</Badge>
                    ) : (
                      <>
                        <Badge>submitted</Badge>
                        <Button variant="ghost" onClick={() => { setSubmitText(""); setSubmitFor(assignment); }}>Resubmit</Button>
                      </>
                    )
                  ) : (
                    <>
                      <Badge tone="warn">pending</Badge>
                      <Button variant="ghost" onClick={() => { setSubmitText(""); setSubmitFor(assignment); }}>Submit</Button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      {materials.length > 0 ? (
        <section className="section" aria-label="Study material">
          <div className="section-head"><h2>Study material</h2></div>
          <Card>
            {materials.map((material) => (
              <div key={material.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--rule)", fontSize: 14 }}>
                <span>
                  <strong>{material.title}</strong>{" "}
                  <span style={{ opacity: 0.65, fontSize: 13 }}>{material.subjectName} · {(material.sizeBytes / 1024).toFixed(1)} KB</span>
                </span>
                <a className="btn ghost" href={api.cwkMaterialUrl(material.id)} download>Download</a>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <Modal
        open={submitFor !== null}
        onClose={() => setSubmitFor(null)}
        title={`Submit — ${submitFor?.title ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSubmitFor(null)}>Cancel</Button>
            <Button onClick={() => void submitWork()} loading={submitting} disabled={submitText.trim() === ""}>
              Submit work
            </Button>
          </>
        }
      >
        {submitFor?.instructions ? (
          <p style={{ marginTop: 0, fontSize: 13.5, whiteSpace: "pre-wrap", opacity: 0.8 }}>{submitFor.instructions}</p>
        ) : null}
        <Field label="Your answer" htmlFor="cwk-answer">
          <textarea id="cwk-answer" rows={6} value={submitText} onChange={(event) => setSubmitText(event.target.value)} />
        </Field>
      </Modal>

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
