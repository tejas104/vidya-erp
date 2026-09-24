"use client";

import { use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  api, ApiError, currentAcademicYear,
  type FeeInvoiceView, type StudentAttendance, type StudentDetailView,
  type StudentDocument, type StudentHistory, type StudentMarksRow, type StudentPerformance,
} from "@/ui/api";
import { Sparkline, StatTile, SubjectBars } from "@/ui/charts";
import { ReportButton } from "@/ui/ReportButton";
import { DeniedState } from "@/ui/DeniedState";
import { AsyncState } from "@/ui/AsyncState";
import { HelpButton } from "@/ui/help/HelpButton";
import { GuardiansPanel } from "@/ui/GuardiansPanel";
import { EmptyState, PageHeader, StatusBadge, Tabs } from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "academics", label: "Academics" },
  { id: "attendance", label: "Attendance" },
  { id: "finance", label: "Finance" },
  { id: "documents", label: "Documents" },
  { id: "family", label: "Family" },
  { id: "history", label: "History" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function tabFromUrl(): TabId {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return TABS.find((tab) => tab.id === requested)?.id ?? "summary";
}

type Load<T> =
  | { state: "loading" }
  | { state: "ok"; data: T }
  | { state: "forbidden" }
  | { state: "not-found" }
  | { state: "error" };

function useResource<T>(load: () => Promise<T>, dependencies: readonly unknown[]): [Load<T>, () => void] {
  const key = JSON.stringify(dependencies);
  const [snapshot, setSnapshot] = useState<{ key: string; result: Load<T> }>({ key, result: { state: "loading" } });
  const [attempt, setAttempt] = useState(0);
  // Callers pass only stable record identity/year values in dependencies. A
  // retry intentionally re-runs one panel without refetching the profile.
  useEffect(() => {
    let alive = true;
    setSnapshot({ key, result: { state: "loading" } });
    void load().then(
      (data) => { if (alive) setSnapshot({ key, result: { state: "ok", data } }); },
      (error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 403) setSnapshot({ key, result: { state: "forbidden" } });
        else if (error instanceof ApiError && error.status === 404) setSnapshot({ key, result: { state: "not-found" } });
        else setSnapshot({ key, result: { state: "error" } });
      },
    );
    return () => { alive = false; };
  }, [key, attempt]);
  return [snapshot.key === key ? snapshot.result : { state: "loading" }, () => setAttempt((value) => value + 1)];
}

function ResourcePanel<T>({
  load, identity, children,
}: {
  load: () => Promise<T>;
  identity: readonly unknown[];
  children: (data: T) => ReactNode;
}) {
  const [result, retry] = useResource(load, identity);
  if (result.state === "forbidden") return <DeniedState title="Not in your scope." message="You can still use the other tabs in this record." />;
  if (result.state === "not-found") return <EmptyState title="This record is no longer available." />;
  return (
    <AsyncState loading={result.state === "loading"} error={result.state === "error"} onRetry={retry}>
      {result.state === "ok" ? children(result.data) : null}
    </AsyncState>
  );
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function rupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}

export default function StudentPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params);
  const fallbackYear = useMemo(() => currentAcademicYear(), []);
  const [profile, retryProfile] = useResource(() => api.studentGet(studentId), [studentId]);
  const [tab, setTab] = useState<TabId>("summary");
  const [accountantOnly, setAccountantOnly] = useState(false);

  useEffect(() => {
    setTab(tabFromUrl());
    const onHistory = () => setTab(tabFromUrl());
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, []);
  useEffect(() => {
    let alive = true;
    void api.session().then((session) => {
      if (alive) setAccountantOnly(session.roles.length > 0 && session.roles.every((role) => role === "accountant"));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const changeTab = (next: string) => {
    const selected = TABS.find((item) => item.id === next)?.id ?? "summary";
    setTab(selected);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", selected);
    window.history.replaceState(null, "", url);
  };

  return (
    <>
      <a className="linklike" href="/dashboard">← Back to the register</a>
      {profile.state === "forbidden" ? <div className={styles.stateRow}><DeniedState title="Outside your scope." message="This student's profile is not available to your account." /></div> : null}
      {profile.state === "not-found" ? <div className={styles.stateRow}><EmptyState title="No such student." body="This record may have been removed." /></div> : null}
      {profile.state === "loading" || profile.state === "error" ? (
        <div className={styles.stateRow}>
          <AsyncState loading={profile.state === "loading"} error={profile.state === "error"} onRetry={retryProfile}>{null}</AsyncState>
        </div>
      ) : null}
      {profile.state === "ok" ? (
        <StudentRecord
          student={profile.data}
          studentId={studentId}
          year={profile.data.enrollment?.academicYear ?? fallbackYear}
          tab={tab}
          changeTab={changeTab}
          accountantOnly={accountantOnly}
        />
      ) : null}
    </>
  );
}

function StudentRecord({ student, studentId, year, tab, changeTab, accountantOnly }: {
  student: StudentDetailView;
  studentId: string;
  year: string;
  tab: TabId;
  changeTab: (tab: string) => void;
  accountantOnly: boolean;
}) {
  const tabScroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reveal = () => {
      const scroller = tabScroller.current;
      const selected = scroller?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!scroller || !selected) return;
      const viewport = scroller.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      if (selectedRect.left < viewport.left) scroller.scrollLeft += selectedRect.left - viewport.left;
      else if (selectedRect.right > viewport.right) scroller.scrollLeft += selectedRect.right - viewport.right;
    };
    reveal();
    window.addEventListener("resize", reveal);
    return () => window.removeEventListener("resize", reveal);
  }, [tab]);
  const place = student.enrollment === null
    ? "Current class not recorded"
    : `${student.enrollment.className} · Section ${student.enrollment.sectionName} · ${student.enrollment.academicYear}`;
  return (
    <>
      <PageHeader
        eyebrow="Student record"
        title={student.fullName}
        lede={`Admission ${student.admissionNo} · ${place}`}
        actions={<StatusBadge status={student.status === "active" ? "good" : "neutral"}>{student.status.replaceAll("_", " ")}</StatusBadge>}
        help={<HelpButton slug="students" />}
      />
      <div ref={tabScroller} className={styles.tabsScroller}>
        <Tabs tabs={[...TABS]} active={tab} onChange={changeTab} />
      </div>
      <section className={styles.tabPanel} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "summary" ? <SummaryPanel student={student} studentId={studentId} year={year} /> : null}
        {tab === "academics" ? accountantOnly ? <DeniedState title="Not in your scope." /> : <AcademicsPanel studentId={studentId} year={year} /> : null}
        {tab === "attendance" ? accountantOnly ? <DeniedState title="Not in your scope." /> : <AttendancePanel studentId={studentId} year={year} /> : null}
        {tab === "finance" ? <FinancePanel studentId={studentId} /> : null}
        {tab === "documents" ? <DocumentsPanel studentId={studentId} /> : null}
        {tab === "family" ? <GuardiansPanel studentId={studentId} /> : null}
        {tab === "history" ? <HistoryPanel studentId={studentId} /> : null}
      </section>
    </>
  );
}

function SummaryPanel({ student, studentId, year }: { student: StudentDetailView; studentId: string; year: string }) {
  return (
    <>
      <div className={`card ${styles.profileCard}`}>
        <h2>Profile</h2>
        <dl className={styles.profileGrid}>
          <dt>Date of birth</dt><dd>{student.dob ?? "Not recorded"}</dd>
          <dt>Phone</dt><dd>{student.phone ?? "Not recorded"}</dd>
          <dt>Guardian contact</dt><dd>{student.guardianName ?? "Not recorded"}{student.guardianPhone ? ` · ${student.guardianPhone}` : ""}</dd>
        </dl>
      </div>
      <h2>Performance</h2>
      <ResourcePanel load={() => api.studentPerformance(studentId, year)} identity={[studentId, year]}>
        {(data) => <PerformancePanel data={data} year={year} />}
      </ResourcePanel>
    </>
  );
}

function PerformancePanel({ data, year }: { data: StudentPerformance; year: string }) {
  return (
    <>
      <p className={styles.explainer}>Figures use only attendance and subjects you are permitted to read. Overall marks appear only when every subject is visible.</p>
      <div className={styles.reportRow}>
        <ReportButton params={{ kind: "student-performance", studentId: data.studentId }} year={year} format="pdf" label="Download report (PDF)" />
        <ReportButton params={{ kind: "student-performance", studentId: data.studentId }} year={year} format="csv" label="Export (CSV)" />
      </div>
      <div className={`card ${styles.statsCard}`}>
        <div className="stats">
          {data.attendance !== null
            ? <StatTile value={`${data.attendance.pct}%`} label="Attendance (YTD)" sub={`${data.attendance.total} sessions`} />
            : <StatTile value="Not recorded" label="Attendance in your scope" muted />}
          {data.overallPct !== null
            ? <StatTile value={`${data.overallPct}%`} label="Overall marks (YTD)" />
            : <StatTile value="Not recorded" label="Overall marks in your scope" muted />}
        </div>
        {data.attendance !== null && data.attendance.monthly.length > 0 ? (
          <div className={styles.trendWrap}>
            <div className={`tile-kind ${styles.trendLabel}`}>Attendance trend</div>
            <Sparkline label="Monthly attendance" points={data.attendance.monthly.map((point) => ({ x: point.month, y: point.pct }))} />
          </div>
        ) : null}
      </div>
      <section className="section" aria-label="Marks by subject">
        <div className="section-head"><h2>By subject</h2><span className="stat-sub num">{data.subjects.length} visible</span></div>
        {data.subjects.length === 0 ? <EmptyState title="No subject marks visible." body="Marks may not be recorded yet, or may be outside your scope." /> : (
          <>
            <SubjectBars rows={data.subjects.map((subject, index) => ({ label: subject.name, value: subject.avgPct, index }))} />
            <div className={`grid ${styles.subjectsGrid}`}>
              {data.subjects.map((subject) => (
                <div className="card" key={subject.subjectId}>
                  <div className="tile-head"><div className={`tile-name ${styles.subjectName}`}>{subject.name}</div><span className={`num ${styles.subjectPct}`}>{subject.avgPct}%</span></div>
                  <Sparkline label={`${subject.name} assessments`} points={subject.series.map((point) => ({ x: point.label, y: point.pct }))} />
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function AcademicsPanel({ studentId, year }: { studentId: string; year: string }) {
  return <ResourcePanel load={() => api.studentMarks(studentId, year)} identity={[studentId, year]}>
    {({ marks }: { marks: StudentMarksRow[] }) => marks.length === 0
      ? <EmptyState title="No marks recorded for this year." />
      : <div className={styles.panelList}>{marks.map(({ mark, assessment }) => (
        <div className="card" key={mark.id}>
          <strong>{assessment.name}</strong>
          <span>{assessment.kind} · {assessment.academicYear}</span>
          <span className="num">{mark.score} / {assessment.maxScore}</span>
        </div>
      ))}</div>}
  </ResourcePanel>;
}

function AttendancePanel({ studentId, year }: { studentId: string; year: string }) {
  return <ResourcePanel load={() => api.studentAttendance(studentId, year)} identity={[studentId, year]}>
    {(data: StudentAttendance) => data.sessions.length === 0
      ? <EmptyState title="No attendance recorded for this year." />
      : <>
        <div className={styles.countRow}>
          {Object.entries(data.counts).map(([label, count]) => <StatTile key={label} label={label} value={String(count)} />)}
        </div>
        <div className={styles.panelList}>{data.sessions.map((session) => (
          <div className="card" key={session.sessionId}>
            <strong>{dateLabel(session.heldOn)}</strong><span>{session.slot}</span><StatusBadge status={session.status === "present" ? "good" : "warn"}>{session.status}</StatusBadge>
          </div>
        ))}</div>
      </>}
  </ResourcePanel>;
}

function FinancePanel({ studentId }: { studentId: string }) {
  return <ResourcePanel load={() => api.feesStudentInvoices(studentId)} identity={[studentId]}>
    {({ invoices }: { invoices: FeeInvoiceView[] }) => invoices.length === 0
      ? <EmptyState title="No invoices recorded." />
      : <>
        <div className={styles.countRow}><StatTile label="Total dues" value={rupees(invoices.reduce((sum, row) => sum + row.duesPaise, 0))} /></div>
        <div className={styles.panelList}>{invoices.map((invoice) => (
          <div className="card" key={invoice.id}>
            <strong>{invoice.headName}</strong><span>Due {dateLabel(invoice.dueOn)} · {invoice.academicYear}</span>
            <span className="num">{rupees(invoice.duesPaise)} due</span>
          </div>
        ))}</div>
      </>}
  </ResourcePanel>;
}

function DocumentsPanel({ studentId }: { studentId: string }) {
  return <ResourcePanel load={() => api.docList(studentId)} identity={[studentId]}>
    {({ documents }: { documents: StudentDocument[] }) => documents.length === 0
      ? <EmptyState title="No documents on file." />
      : <div className={styles.panelList}>{documents.map((document) => (
        <div className="card" key={document.id}>
          <strong>{document.filename}</strong><span>{document.kind.replaceAll("_", " ")} · Added {dateLabel(document.createdAt)}</span>
          <a className="linklike" href={api.docDownloadUrl(document.id)} target="_blank" rel="noreferrer">View document</a>
        </div>
      ))}</div>}
  </ResourcePanel>;
}

function HistoryPanel({ studentId }: { studentId: string }) {
  return <ResourcePanel load={() => api.studentHistory(studentId)} identity={[studentId]}>
    {(history: StudentHistory) => <div className={styles.historySections}>
      <section aria-label="Enrollment history">
        <h2>Enrollment history</h2>
        {history.enrollments.length === 0 ? <EmptyState title="No enrollment recorded." /> : (
          <div className={styles.panelList}>{history.enrollments.map((entry) => (
            <div className="card" key={entry.id}>
              <strong>{entry.className} · Section {entry.sectionName}</strong>
              <span>{entry.academicYear} · {entry.status} · Recorded {dateLabel(entry.createdAt)}</span>
            </div>
          ))}</div>
        )}
      </section>
      <section aria-label="Status changes">
        <h2>Status changes</h2>
        {history.statusChanges.length === 0 ? <EmptyState title="No status changes recorded." /> : (
          <div className={styles.panelList}>{history.statusChanges.map((change, index) => (
            <div className="card" key={`${change.occurredAt}-${index}`}>
              <strong>{change.from.replaceAll("_", " ")} → {change.to.replaceAll("_", " ")}</strong>
              <span>{dateLabel(change.occurredAt)}</span>
            </div>
          ))}</div>
        )}
      </section>
      <section aria-label="Audit events">
        <h2>Audit events</h2>
        {history.events.length === 0 ? <EmptyState title="No audit events recorded." /> : (
          <div className={styles.panelList}>{history.events.map((event, index) => (
            <div className="card" key={`${event.occurredAt}-${index}`}>
              <strong>{event.action.replaceAll("-", " ")}</strong>
              <span>{dateLabel(event.occurredAt)}{event.actorId ? ` · Actor ${event.actorId}` : ""}</span>
            </div>
          ))}</div>
        )}
      </section>
    </div>}
  </ResourcePanel>;
}
