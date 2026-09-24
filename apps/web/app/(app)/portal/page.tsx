"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type CwkAssignment,
  type CwkMaterial,
  type ExamSlotView,
  type FeeMyInvoice,
  type MyResults,
  type MySyllabus,
  type PortalAttendance,
  type PortalMarks,
  type PortalMe,
  type TtEntry,
  type TtPeriod,
} from "@/ui/api";
import { HelpButton } from "@/ui/help/HelpButton";
import { useHelpEdition } from "@/ui/help/HelpEditionContext";
import { SchoolTermMarks } from "@/ui/SchoolTermMarks";
import {
  useToast,
  Button,
  Modal,
  PageHeader,
  Card,
  StatusBadge,
  StatCard,
  Table,
  EmptyState,
  Skeleton,
  type TableColumn,
} from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import { StatTile, Sparkline, SubjectBars, TrendLine } from "@/ui/charts";
import { formatPaise } from "@/ui/money";
import { Noticeboard } from "@/ui/Noticeboard";
import { ReportButton } from "@/ui/ReportButton";
import { OnboardingChecklist } from "@/ui/OnboardingChecklist";
import styles from "./page.module.css";

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
      /** null = fees module not answering (unlicensed / not deployed) — the section stays hidden. */
      fees: FeeMyInvoice[] | null;
      /** null = results module not answering — the section stays hidden. */
      results: MyResults | null;
      /** null = exams module not answering — the section stays hidden. */
      exams: ExamSlotView[] | null;
      /** null = syllabus module not answering — the section stays hidden. */
      syllabus: MySyllabus | null;
    };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_TONE: Record<string, "good" | "warn" | "danger"> = {
  present: "good",
  late: "warn",
  absent: "danger",
  excused: "warn",
};

type SessionRow = { heldOn: ReactNode; status: ReactNode };

export type PortalView = "overview" | "schedule" | "assignments" | "marks" | "exams" | "syllabus" | "attendance" | "fees" | "notices";
const SCHOOL_VIEW_TITLES: Record<PortalView, string> = {
  overview: "My school day", schedule: "My timetable", assignments: "Assignments & materials",
  marks: "My marks", exams: "My exams", syllabus: "What we're learning",
  attendance: "My attendance", fees: "My fees", notices: "School notices",
};

export default function PortalPage({ view = "overview" }: { view?: PortalView }) {
  const toast = useToast();
  const edition = useHelpEdition();
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
      toast.push({ status: "good", message: `Submitted "${submitFor.title}".` });
      setSubmitFor(null);
      setSubmitText("");
      setReloadTick((t) => t + 1);
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't submit." });
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
          edition === "school" ? Promise.resolve({ subjects: [], overallPct: null } as PortalMarks) : api.portalMarks(year),
          api.portalTimetable(year).catch(() => ({ periods: [], entries: [] })),
          api.portalToday(year).catch(() => ({ dayOfWeek: 0, periods: [], entries: [] })),
          api.cwkMyAssignments(year).catch(() => ({ assignments: [] as CwkAssignment[] })),
          api.cwkMyMaterials(year).catch(() => ({ materials: [] as CwkMaterial[] })),
        ]);
        const fees = await api.feesMyFees().then((r) => r.invoices).catch(() => null);
        const results = edition === "school" ? null : await api.resMyResults().catch(() => null);
        const exams = await api.exmMySchedule().then((r) => r.slots).catch(() => null);
        const syllabus = await api.mySyllabus(year).catch(() => null);
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
            fees,
            results,
            exams,
            syllabus,
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
  }, [year, reloadTick, edition]);

  if (load.state === "loading") {
    return (
      <div className={styles.skeletonStack} aria-hidden="true">
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={16} />
      </div>
    );
  }
  if (load.state === "unlinked") {
    return (
      <EmptyState
        title="Your sign-in isn't linked to a student record yet."
        body="Ask the office to link your account — then your attendance and marks appear here."
      />
    );
  }
  if (load.state === "error") return <EmptyState title="Couldn't load your register." body="Try again shortly." />;

  const { me, attendance, marks, timetable, today, assignments, materials, fees, results, exams, syllabus } = load;
  const show = (section: PortalView) => edition !== "school" || view === section;
  const todayIso = new Date().toISOString().slice(0, 10);
  const shortDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  const totalDues = fees === null ? 0 : fees.reduce((sum, invoice) => sum + invoice.duesPaise, 0);
  const nextSteps = [
    ...assignments.filter((assignment) => !assignment.mySubmission).map((assignment) => ({
      key: `assignment-${assignment.id}`, date: assignment.dueOn, label: assignment.title,
      detail: `${assignment.subjectName} assignment`, href: "/portal/assignments", action: "Open assignment",
    })),
    ...(fees ?? []).filter((invoice) => invoice.duesPaise > 0).map((invoice) => ({
      key: `fee-${invoice.id}`, date: invoice.dueOn, label: `${invoice.headName} payment`,
      detail: `${formatPaise(invoice.duesPaise)} due`, href: "/portal/fees", action: "View fee",
    })),
    ...(exams ?? []).filter((exam) => exam.onDate >= todayIso).map((exam) => ({
      key: `exam-${exam.id}`, date: exam.onDate, label: `${exam.subjectName} exam`,
      detail: exam.seriesName, href: "/portal/exams", action: "View exam",
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))
    .filter((item, index, items) => items.findIndex((candidate) => candidate.href === item.href) === index)
    .slice(0, 3);
  const gridCell = (day: number, periodNo: number) =>
    timetable.entries.find((entry) => entry.dayOfWeek === day && entry.periodNo === periodNo);
  const sessionColumns: TableColumn<SessionRow>[] = [
    { key: "heldOn", header: "Date", figure: true },
    { key: "status", header: "Status" },
  ];
  const sessionRows: SessionRow[] = attendance.sessions.map((row) => ({
    heldOn: <span className="num">{row.heldOn}</span>,
    status: <StatusBadge status={STATUS_TONE[row.status] ?? "warn"}>{row.status}</StatusBadge>,
  }));

  return (
    <>
      <PageHeader
        eyebrow={edition === "school" ? "Student workspace" : "My register"}
        title={edition === "school" && view !== "overview" ? SCHOOL_VIEW_TITLES[view] : `Hello, ${me.student.fullName.split(" ")[0]}.`}
        lede={
          me.enrollment
            ? `${me.enrollment.className} · Section ${me.enrollment.sectionName} · AY ${me.enrollment.academicYear} · ${me.student.admissionNo}`
            : `Admission no. ${me.student.admissionNo} — not enrolled this year.`
        }
        help={<HelpButton slug="portal" />}
      />

      {show("overview") && edition !== "school" ? <OnboardingChecklist role="student" studentEdition={edition} /> : null}

      {show("overview") ? <section className="stats" aria-label="My figures" style={{ marginBottom: "var(--space-5)" }}>
        <StatTile
          value={attendance.pct === null ? "—" : `${attendance.pct}%`}
          label="My attendance (YTD)"
          sub={`${attendance.counts.present + attendance.counts.late + attendance.counts.absent + attendance.counts.excused} sessions`}
          muted={attendance.pct === null}
        />
        {edition !== "school" ? <StatTile
          value={marks.overallPct === null ? "—" : `${marks.overallPct}%`}
          label="My overall marks (YTD)"
          muted={marks.overallPct === null}
        /> : null}
        {Object.values(attendance.counts).some((count) => count > 0) ? <StatTile value={String(attendance.counts.absent)} label="Days absent" /> : null}
      </section> : null}

      {edition === "school" && view === "overview" ? <section className={styles.nextSteps} aria-label="Your next steps">
        <div className="section-head"><h2>Coming up</h2><span className="stat-sub">Nearest deadlines</span></div>
        {nextSteps.length === 0 ? <p className={styles.nextStepsEmpty}>No upcoming work in the available records. Check your notices for school updates.</p> :
          <ol>{nextSteps.map((item) => <li key={item.key}>
            <time className={styles.stepDate} dateTime={item.date}>{item.date < todayIso ? `Overdue · ${shortDate(item.date)}` : shortDate(item.date)}</time>
            <span className={styles.stepText}><strong>{item.label}</strong><small>{item.detail}</small></span>
            <a href={item.href} aria-label={`${item.action}: ${item.label}`}>{item.action} <span aria-hidden="true">→</span></a>
          </li>)}</ol>}
      </section> : null}

      {edition === "school" && view === "overview" ? <nav className={styles.quickGrid} aria-label="Explore your school workspace">
        <a href="/portal/schedule"><strong>Timetable</strong><span>Classes and teachers this week →</span></a>
        <a href="/portal/assignments"><strong>Assignments</strong><span>{assignments.length} set for your class →</span></a>
        <a href="/portal/marks"><strong>Marks</strong><span>Term progress and grades →</span></a>
        <a href="/portal/attendance"><strong>Attendance</strong><span>Your recorded days →</span></a>
      </nav> : null}

      {show("overview") && today.entries.length > 0 ? (
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

      {show("schedule") && timetable.entries.length > 0 ? (
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
      {edition === "school" && view === "schedule" && timetable.entries.length === 0 ?
        <EmptyState title="No timetable published yet." body="Your classes will appear here when the school adds the weekly schedule." /> : null}

      {show("assignments") ? <section className="section" aria-label="My assignments">
        <div className="section-head">
          <h2>Assignments</h2>
          <span className="stat-sub num">{assignments.length}</span>
        </div>
        {assignments.length === 0 ? (
          <EmptyState title="No assignments yet." body="Work your teachers assign appears here." />
        ) : (
          <Card>
            {assignments.map((assignment) => (
              <div key={assignment.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 0", borderTop: "1px solid var(--rule)" }}>
                <span>
                  <strong>{assignment.title}</strong>{" "}
                  <span style={{ opacity: 0.65, fontSize: 13 }}>{assignment.subjectName} · due <span className="num">{assignment.dueOn}</span></span>
                </span>
                <span className={styles.chipRow}>
                  {assignment.mySubmission ? (
                    assignment.mySubmission.score !== null ? (
                      <StatusBadge status="good">scored {assignment.mySubmission.score}{assignment.maxScore !== null ? `/${assignment.maxScore}` : ""}</StatusBadge>
                    ) : (
                      <>
                        <StatusBadge status="neutral">submitted</StatusBadge>
                        <Button variant="ghost" onClick={() => { setSubmitText(""); setSubmitFor(assignment); }}>Resubmit</Button>
                      </>
                    )
                  ) : (
                    <>
                      <StatusBadge status="warn">pending</StatusBadge>
                      <Button variant="ghost" onClick={() => { setSubmitText(""); setSubmitFor(assignment); }}>Submit</Button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section> : null}

      {show("assignments") && materials.length > 0 ? (
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

      {show("assignments") ? <Modal
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
          <p className={styles.instructions}>{submitFor.instructions}</p>
        ) : null}
        <div className={styles.field}>
          <label htmlFor="cwk-answer" className={styles.label}>Your answer</label>
          <textarea id="cwk-answer" className={styles.textarea} rows={6} value={submitText} onChange={(event) => setSubmitText(event.target.value)} />
        </div>
      </Modal> : null}

      {show("attendance") && attendance.monthly.length > 0 ? (
        <section className="section" aria-label="Attendance trend">
          <div className="section-head"><h2>Attendance by month</h2></div>
          <Card>
            <TrendLine label="My monthly attendance" points={attendance.monthly.map((m) => ({ x: m.month, y: m.pct }))} />
          </Card>
        </section>
      ) : null}

      {show("marks") ? edition === "school" ? <SchoolTermMarks academicYear={year} /> : <section id="portal-marks" className="section" aria-label="Marks by subject">
        <div className="section-head">
          <h2>My marks</h2>
          <span className="stat-sub num">{marks.subjects.length} subjects</span>
        </div>
        {marks.subjects.length === 0 ? (
          <EmptyState title="No marks yet." body="Scores appear here as your teachers enter them." />
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
      </section> : null}

      {/* --- results --- */}
      {show("marks") && results !== null ? (
        <section className="section" aria-label="My results">
          <div className="section-head">
            <h2>My results</h2>
            {results.cgpa !== null ? (
              <span className="stat-sub num">CGPA {results.cgpa.toFixed(2)}</span>
            ) : null}
          </div>
          {results.terms.length === 0 ? (
            <EmptyState
              title="Results aren't published yet."
              body="Your grade card appears here the moment the principal publishes a term."
            />
          ) : (
            <div className="grid">
              {results.terms.map((termResult) => (
                <Card key={`${termResult.academicYear}-${termResult.term}`} title={`${termResult.term} · ${termResult.academicYear}`}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span className="num" style={{ fontSize: 34, fontWeight: 600 }}>{termResult.sgpa.toFixed(2)}</span>
                    <span style={{ fontSize: 13, opacity: 0.65 }}>SGPA</span>
                  </div>
                  <div style={{ marginTop: "var(--space-2)", display: "grid", gap: 4, fontSize: 13.5 }}>
                    {termResult.subjects.map((subject) => (
                      <div key={subject.subjectId} className={styles.subjectRow}>
                        <span>{subject.subjectName} <span style={{ opacity: 0.55 }}>({subject.credits} cr)</span></span>
                        <StatusBadge status={subject.points === 0 ? "danger" : "good"}>{subject.grade}</StatusBadge>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: "var(--space-3)" }}>
                    <ReportButton
                      params={{ kind: "grade-card", studentId: me.student.id }}
                      year={termResult.academicYear}
                      label="Download grade card (PDF)"
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* --- exams --- */}
      {show("exams") && exams !== null ? (
        <section className="section" aria-label="My exams">
          <div className="section-head">
            <h2>My exams</h2>
            {exams.length > 0 ? (
              <ReportButton
                params={{ kind: "hall-ticket", studentId: me.student.id }}
                year={year}
                label="Download hall ticket (PDF)"
              />
            ) : null}
          </div>
          {exams.length === 0 ? (
            <EmptyState title="No exams scheduled." body="Your exam timetable appears here when the office publishes it." />
          ) : (
            <>
              {(() => {
                const next = exams.find((slot) => slot.onDate >= todayIso);
                return next !== undefined ? (
                  <Card title={`Next: ${next.subjectName}`}>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline" }}>
                      <span className="num" style={{ fontSize: 22, fontWeight: 600 }}>{next.onDate}</span>
                      <span className="num">{next.starts}–{next.ends}</span>
                      {next.room !== "" ? <StatusBadge status="neutral">{`Room ${next.room}`}</StatusBadge> : null}
                      <span style={{ opacity: 0.65, fontSize: 13 }}>{next.seriesName}</span>
                    </div>
                  </Card>
                ) : null;
              })()}
              <div className="ui-tablewrap" style={{ marginTop: "var(--space-3)" }}>
                <table className="ui-table">
                  <thead>
                    <tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Paper</th><th scope="col">Room</th></tr>
                  </thead>
                  <tbody>
                    {exams.map((slot) => (
                      <tr key={slot.id}>
                        <td><span className="num">{slot.onDate}</span></td>
                        <td><span className="num">{slot.starts}–{slot.ends}</span></td>
                        <td><strong>{slot.subjectName}</strong> <span style={{ opacity: 0.6, fontSize: 12.5 }}>{slot.seriesName}</span></td>
                        <td>{slot.room === "" ? "—" : slot.room}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}
      {edition === "school" && view === "exams" && exams === null ?
        <EmptyState title="Exam schedule unavailable." body="Try again shortly." /> : null}

      {/* --- syllabus coverage --- */}
      {show("syllabus") && syllabus !== null && syllabus.subjects.length > 0 ? (
        <section className="section" aria-label="Course coverage">
          <div className="section-head"><h2>Course coverage</h2></div>
          <div className="grid">
            {syllabus.subjects.map((subject) => {
              const tone = subject.coveragePct >= 100 ? "good" : subject.coveragePct > 0 ? "warn" : "bad";
              const units = subject.units.slice().sort((a, b) => a.position - b.position);
              return (
                <Card key={subject.subjectId} title={subject.subjectName}>
                  <StatCard
                    pct={subject.coveragePct}
                    display={`${Math.round(subject.coveragePct)}%`}
                    label="Coverage"
                    value={`${units.length} unit${units.length === 1 ? "" : "s"}`}
                    tone={tone}
                  />
                  <div style={{ marginTop: "var(--space-3)", display: "grid", gap: 6 }}>
                    {units.map((unit) => (
                      <details key={unit.id}>
                        <summary style={{ cursor: "pointer", fontSize: 14 }}>
                          <strong>{unit.title}</strong>{" "}
                          <span style={{ opacity: 0.65, fontSize: 12.5 }}>{Math.round(unit.coveragePct)}%</span>
                        </summary>
                        <div style={{ marginTop: 6, display: "grid", gap: 4, paddingLeft: "var(--space-3)" }}>
                          {unit.topics
                            .slice()
                            .sort((a, b) => a.position - b.position)
                            .map((topic) => (
                              <div key={topic.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                <span
                                  aria-hidden="true"
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: topic.taughtOn !== null ? "var(--good)" : "var(--line-2)",
                                    flexShrink: 0,
                                  }}
                                />
                                <span>{topic.title}</span>
                                {topic.taughtOn !== null ? (
                                  <span className="num" style={{ opacity: 0.6, fontSize: 12 }}>{topic.taughtOn}</span>
                                ) : null}
                              </div>
                            ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}
      {edition === "school" && view === "syllabus" && (syllabus === null || syllabus.subjects.length === 0) ?
        <EmptyState title={syllabus === null ? "Syllabus unavailable." : "No syllabus shared yet."} body="Your subjects and topics will appear here when teachers add them." /> : null}

      {/* --- notices --- */}
      {show("notices") ? <Noticeboard /> : null}

      {show("fees") && fees !== null ? (
        <section id="portal-fees" className="section" aria-label="My fees">
          <div className="section-head">
            <h2>My fees</h2>
            {fees.length > 0 ? <span className="stat-sub num">
              {totalDues > 0 ? `Dues: ${formatPaise(totalDues)}` : `No dues — you're clear for ${year}`}
            </span> : null}
          </div>
          {fees.length === 0 ? (
            <EmptyState title="No invoices yet." body="Fee invoices appear here once the office generates them." />
          ) : (
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              {fees.map((invoice) => (
                <details key={invoice.id} className="card" style={{ padding: "var(--space-3) var(--space-4)" }}>
                  <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span>
                      <strong>{invoice.headName}</strong>{" "}
                      <span className="num" style={{ opacity: 0.6, fontSize: 12.5 }}>due {invoice.dueOn}</span>
                    </span>
                    <span className={styles.chipRow}>
                      <span className="num">{formatPaise(invoice.duesPaise)} due</span>
                      {invoice.status === "paid" ? <StatusBadge status="good">paid</StatusBadge>
                        : invoice.status === "waived" ? <StatusBadge status="neutral">waived</StatusBadge>
                        : invoice.status === "part" ? <StatusBadge status="warn">part</StatusBadge>
                        : invoice.dueOn < todayIso ? <StatusBadge status="danger">overdue</StatusBadge>
                        : <StatusBadge status="neutral">pending</StatusBadge>}
                    </span>
                  </summary>
                  <div style={{ marginTop: "var(--space-2)", display: "grid", gap: 4, fontSize: 13.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Invoice amount</span>
                      <span className="num">{formatPaise(invoice.amountPaise)}</span>
                    </div>
                    {invoice.payments.map((payment) => (
                      <div key={payment.id} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>
                          Receipt <span className="num">#{payment.receiptNo}</span> · {payment.mode} ·{" "}
                          <span className="num">{payment.receivedAt.slice(0, 10)}</span>
                        </span>
                        <span className="num">− {formatPaise(payment.amountPaise)}</span>
                      </div>
                    ))}
                    {invoice.adjustments.map((adjustment) => (
                      <div key={adjustment.id} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{adjustment.kind}{adjustment.reason !== "" ? ` — ${adjustment.reason}` : ""}</span>
                        <span className="num">{adjustment.kind === "fine" ? "+" : "−"} {formatPaise(adjustment.amountPaise)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      ) : null}
      {edition === "school" && view === "fees" && fees === null ?
        <EmptyState title="Fee records unavailable." body="Try again shortly or contact the school office." /> : null}

      {show("attendance") ? <section id="portal-attendance" className="section" aria-label="Recent sessions">
        <div className="section-head"><h2>Recent attendance</h2></div>
        <AsyncState
          loading={false}
          error={false}
          isEmpty={attendance.sessions.length === 0}
          empty={<EmptyState title="No sessions recorded yet." />}
        >
          <Table columns={sessionColumns} rows={sessionRows} />
        </AsyncState>
      </section> : null}
    </>
  );
}
