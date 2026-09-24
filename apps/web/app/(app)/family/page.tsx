"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, Input, PageHeader, StatusBadge, Tabs } from "@vidya/ui-system";
import {
  api,
  ApiError,
  currentAcademicYear,
  type GuardianChild,
  type ChildFeeInvoice,
  type ChildNotice,
  type ChildReportCard,
  type PortalAttendance,
  type PortalMarks,
  type TtEntry,
  type TtPeriod,
} from "@/ui/api";
import { AsyncState } from "@/ui/AsyncState";
import { StatTile, SubjectBars } from "@/ui/charts";
import { formatPaise } from "@/ui/money";
import { HelpButton } from "@/ui/help/HelpButton";
import { useHelpEdition } from "@/ui/help/HelpEditionContext";
import { SchoolTermMarks } from "@/ui/SchoolTermMarks";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/**
 * The family portal (ADR-0027). A guardian sees each linked child's records
 * only in the categories their relationship covers; the server decides every
 * one of those per request, and this page merely skips what it was not given.
 */

type Children = { state: "loading" } | { state: "error" } | { state: "ok"; children: GuardianChild[] };

type ChildRecords = {
  attendance: PortalAttendance | null;
  marks: PortalMarks | null;
  today: { dayOfWeek: number; periods: TtPeriod[]; entries: TtEntry[] } | null;
};
type FamilyView = "overview" | "learning" | "fees" | "notices" | "link";

/** A category the server withholds answers 403: show nothing, not an error. */
async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 403) return null;
    throw caught;
  }
}

export default function FamilyPage() {
  const edition = useHelpEdition();
  const year = useMemo(() => currentAcademicYear(), []);
  const [list, setList] = useState<Children>({ state: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<FamilyView>("overview");

  const load = useCallback(() => {
    api
      .guardianChildren()
      .then(({ children }) => {
        setList({ state: "ok", children });
        setSelected((current) => current ?? children[0]?.studentId ?? null);
      })
      .catch(() => setList({ state: "error" }));
  }, []);

  useEffect(load, [load]);

  if (list.state !== "ok") {
    return <AsyncState loading={list.state === "loading"} error={list.state === "error"} onRetry={load}>{null}</AsyncState>;
  }

  const child = list.children.find((candidate) => candidate.studentId === selected) ?? null;
  const sections: { id: FamilyView; label: string }[] = [
    { id: "overview", label: "Overview" },
    ...(child?.categories.some((category) => category === "marks" || category === "report-card") ? [{ id: "learning" as const, label: "Learning" }] : []),
    ...(child?.categories.includes("fees") ? [{ id: "fees" as const, label: "Fees" }] : []),
    ...(child?.categories.includes("notices") ? [{ id: "notices" as const, label: "Notices" }] : []),
    { id: "link", label: "Link a child" },
  ];
  const activeView = sections.some((section) => section.id === view) ? view : "overview";

  return (
    <>
      <PageHeader
        eyebrow="Family"
        title={child?.fullName ?? "Your children"}
        lede={child !== null ? `Admission no. ${child.admissionNo} · ${year}` : undefined}
        help={<HelpButton slug="family" />}
      />

      {list.children.length > 1 ? (
        <div className={styles.switcher}>
          <Tabs
            tabs={list.children.map((candidate) => ({ id: candidate.studentId, label: candidate.fullName }))}
            active={selected ?? ""}
            onChange={setSelected}
          />
        </div>
      ) : null}

      {child !== null && (child.status === "active" || child.status === "restricted") ? (
        <nav className={styles.sections} aria-label="Family sections">
          {sections.map((section) => <button key={section.id} type="button" aria-pressed={activeView === section.id}
            onClick={() => setView(section.id)}>{section.label}</button>)}
        </nav>
      ) : null}

      {child === null ? (
        <EmptyState
          title="No children linked yet."
          body="When the school gives you an invitation code for your child, enter it below."
        />
      ) : child.status === "pending" ? (
        <EmptyState
          title="Waiting for the school to confirm you."
          body="Your link to this child needs to be verified by the school office before their records appear. You don't need to do anything else."
        />
      ) : child.status !== "active" && child.status !== "restricted" ? (
        <EmptyState title="This link is no longer active." body="Contact the school office if you think this is a mistake." />
      ) : (
        <>
          {activeView === "overview" ? <ChildView key={`${child.studentId}:overview`} child={child} year={year} view="overview" /> : null}
          {activeView === "learning" ? <>
            {edition !== "school" && child.categories.includes("marks") ? <ChildView key={`${child.studentId}:learning`} child={child} year={year} view="learning" /> : null}
            {edition === "school" && child.categories.includes("marks") ? <SchoolTermMarks key={`marks:${child.studentId}`} academicYear={year} studentId={child.studentId} /> : null}
            {child.categories.includes("report-card") ? <ChildReportCards key={`cards:${child.studentId}`} studentId={child.studentId} /> : null}
          </> : null}
          {activeView === "fees" && child.categories.includes("fees") ? <ChildFees key={`fees:${child.studentId}`} studentId={child.studentId} /> : null}
          {activeView === "notices" && child.categories.includes("notices") ? <ChildNotices key={`notices:${child.studentId}`} studentId={child.studentId} /> : null}
        </>
      )}

      {child === null || (child.status !== "active" && child.status !== "restricted") || activeView === "link" ? <LinkAnotherChild onLinked={load} /> : null}
    </>
  );
}

function ChildView({ child, year, view }: { child: GuardianChild; year: string; view: "overview" | "learning" }) {
  const [records, setRecords] = useState<{ state: "loading" } | { state: "error" } | { state: "ok"; data: ChildRecords }>({ state: "loading" });
  const can = (category: string) => child.categories.includes(category);

  const load = useCallback(() => {
    setRecords({ state: "loading" });
    Promise.all([
      view === "overview" && can("attendance") ? orNull(api.childAttendance(child.studentId, year)) : Promise.resolve(null),
      // School assessment marks live in the school term engine, while this
      // legacy portal endpoint reads college assessment marks. Showing its
      // empty result beside a populated school report card misstates the data.
      view === "learning" && can("marks") ? orNull(api.childMarks(child.studentId, year)) : Promise.resolve(null),
      view === "overview" && can("timetable") ? orNull(api.childToday(child.studentId, year)) : Promise.resolve(null),
    ])
      .then(([attendance, marks, today]) => setRecords({ state: "ok", data: { attendance, marks, today } }))
      .catch(() => setRecords({ state: "error" }));
  }, [child, year, view]);

  useEffect(load, [load]);

  if (records.state !== "ok") {
    return <AsyncState loading={records.state === "loading"} error={records.state === "error"} onRetry={load}>{null}</AsyncState>;
  }
  const { attendance, marks, today } = records.data;
  if (view === "overview" && attendance === null && today === null) {
    return <EmptyState title="No overview records available." body="Choose a section above to see the records shared for this child." />;
  }
  const sessions = attendance === null ? 0 : Object.values(attendance.counts).reduce((sum, n) => sum + n, 0);

  return (
    <>
      <section className="stats" aria-label="At a glance">
        {attendance !== null ? (
          <StatTile
            value={attendance.pct === null ? "Not recorded" : `${attendance.pct}%`}
            label="Attendance this year"
            sub={sessions === 0 ? "No register taken yet" : `${sessions} sessions`}
            muted={attendance.pct === null}
          />
        ) : null}
        {/* "0 days absent" before any register is taken would be an invented figure. */}
        {attendance !== null && sessions > 0 ? <StatTile value={String(attendance.counts.absent)} label="Days absent" /> : null}
        {marks !== null ? (
          <StatTile
            value={marks.overallPct === null ? "Not recorded" : `${marks.overallPct}%`}
            label="Overall marks this year"
            muted={marks.overallPct === null}
          />
        ) : null}
      </section>

      {today !== null ? (
        <section className="section" aria-label="Today">
          <div className="section-head"><h2>Today</h2></div>
          {today.entries.length === 0 ? (
            <EmptyState title="No classes today." />
          ) : (
            <Card>
              <ul className={styles.periods}>
                {today.entries.map((entry) => {
                  const period = today.periods.find((candidate) => candidate.periodNo === entry.periodNo);
                  return (
                    <li key={entry.id} className={styles.period}>
                      <span className="num">
                        P{entry.periodNo}
                        {period !== undefined ? ` · ${period.starts}–${period.ends}` : ""}
                      </span>
                      <strong>{entry.subjectName}</strong>
                      <span className={styles.muted}>{entry.teacherName}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>
      ) : null}

      {marks !== null ? (
        <section className="section" aria-label="Marks by subject">
          <div className="section-head"><h2>Marks</h2></div>
          {marks.subjects.length === 0 ? (
            <EmptyState title="No marks recorded yet." body="Scores appear here as teachers enter them." />
          ) : (
            <Card>
              <SubjectBars rows={marks.subjects.map((subject, index) => ({ label: subject.name, value: subject.avgPct, index }))} />
            </Card>
          )}
        </section>
      ) : null}

      {attendance !== null && attendance.sessions.length > 0 ? (
        <section className="section" aria-label="Recent attendance">
          <div className="section-head"><h2>Recent attendance</h2></div>
          <Card>
            <ul className={styles.periods}>
              {attendance.sessions.slice(0, 10).map((row) => (
                <li key={row.heldOn} className={styles.period}>
                  <span className="num">{row.heldOn}</span>
                  <StatusBadge status={row.status === "absent" ? "danger" : row.status === "late" ? "warn" : "good"}>{row.status}</StatusBadge>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

    </>
  );
}

function useChildData<T>(request: () => Promise<T>) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; value: T }>({ kind: "loading" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    request().then((value) => { if (active) setState({ kind: "ready", value }); })
      .catch(() => { if (active) setState({ kind: "error" }); });
    return () => { active = false; };
  }, [request, version]);
  return { state, retry: () => setVersion((current) => current + 1) };
}

function ChildFees({ studentId }: { studentId: string }) {
  const request = useCallback(() => api.childFees(studentId), [studentId]);
  const { state, retry } = useChildData(request);
  const invoices: ChildFeeInvoice[] = state.kind === "ready" ? state.value.invoices : [];
  const due = invoices.reduce((sum, invoice) => sum + invoice.duesPaise, 0);
  return <section className="section" aria-label="Fees">
    <div className="section-head"><h2>Fees</h2>{state.kind === "ready" && invoices.length ? <strong className="num">{formatPaise(due)} due</strong> : null}</div>
    <AsyncState loading={state.kind === "loading"} error={state.kind === "error"} onRetry={retry} errorMessage="Couldn't load fees for this child.">
      {invoices.length === 0 ? <EmptyState title="No invoices yet." body="School fees will appear here when issued." /> :
        <Card><ul className={styles.recordList}>{invoices.map((invoice) => <li key={invoice.id} className={styles.record}>
          <div className={styles.recordTop}><div><strong>{invoice.headName}</strong><small>{invoice.academicYear} · Due {invoice.dueOn}</small></div><StatusBadge status={invoice.duesPaise > 0 ? "warn" : "good"}>{invoice.status}</StatusBadge></div>
          <div className={styles.feeAmounts}><span>Total <strong className="num">{formatPaise(invoice.amountPaise)}</strong></span><span>Paid <strong className="num">{formatPaise(invoice.paidPaise)}</strong></span><span>Due <strong className="num">{formatPaise(invoice.duesPaise)}</strong></span></div>
          {invoice.payments.length ? <details><summary>Receipts ({invoice.payments.length})</summary><ul className={styles.receipts}>{invoice.payments.map((payment) => <li key={payment.receiptNo}>#{payment.receiptNo} · {formatPaise(payment.amountPaise)} · {payment.receivedAt.slice(0, 10)}</li>)}</ul></details> : null}
        </li>)}</ul></Card>}
    </AsyncState>
  </section>;
}

function ChildReportCards({ studentId }: { studentId: string }) {
  const request = useCallback(() => api.childReportCards(studentId), [studentId]);
  const { state, retry } = useChildData(request);
  const cards: ChildReportCard[] = state.kind === "ready" ? state.value.reportCards : [];
  return <section className="section" aria-label="Report cards">
    <div className="section-head"><h2>Report cards</h2></div>
    <AsyncState loading={state.kind === "loading"} error={state.kind === "error"} onRetry={retry} errorMessage="Couldn't load report cards for this child.">
      {cards.length === 0 ? <EmptyState title="No report cards published yet." body="The school will release report cards here when they are ready." /> :
        <Card><ul className={styles.recordList}>{cards.map((card) => <li key={card.snapshotId} className={styles.record}>
          <div className={styles.recordTop}><div><strong>{card.termName}</strong><small>{card.academicYear} · Issued {card.generatedAt.slice(0, 10)}</small></div><StatusBadge status="good">Published</StatusBadge></div>
          <div className={styles.feeAmounts}><span>Overall <strong>{card.overall.complete && card.overall.percentage !== null ? `${card.overall.percentage.toFixed(1)}%` : "Incomplete"}</strong></span><span>Grade <strong>{card.overall.grade ?? "Not available"}</strong></span><span>Attendance <strong>{card.attendance.complete && card.attendance.percentage !== null ? `${card.attendance.percentage.toFixed(1)}%` : "Incomplete"}</strong></span></div>
          <a className="ui-btn ui-btn-primary" href={api.childReportCardDownloadUrl(studentId, card.snapshotId)}>Download PDF</a>
        </li>)}</ul></Card>}
    </AsyncState>
  </section>;
}

function ChildNotices({ studentId }: { studentId: string }) {
  const request = useCallback(() => api.childNotices(studentId), [studentId]);
  const { state, retry } = useChildData(request);
  const notices: ChildNotice[] = state.kind === "ready" ? state.value.notices : [];
  return <section className="section" aria-label="School notices">
    <div className="section-head"><h2>School notices</h2></div>
    <AsyncState loading={state.kind === "loading"} error={state.kind === "error"} onRetry={retry} errorMessage="Couldn't load notices for this child.">
      {notices.length === 0 ? <EmptyState title="No current notices." body="School and class notices will appear here when published." /> :
        <Card><ul className={styles.recordList}>{notices.map((notice) => <li key={notice.id} className={styles.record}>
          <div className={styles.recordTop}><strong>{notice.title}</strong><small>{notice.eventDate ?? notice.publishAt.slice(0, 10)}</small></div>
          <p>{notice.body}</p>
        </li>)}</ul></Card>}
    </AsyncState>
  </section>;
}

function LinkAnotherChild({ onLinked }: { onLinked: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const linked = await api.guardianRedeem(code.trim());
      setCode("");
      setMessage({
        kind: "ok",
        text: linked.status === "active" ? `${linked.child.fullName} is now linked.` : `${linked.child.fullName} is linked, waiting for the school to confirm you.`,
      });
      onLinked();
    } catch {
      setMessage({ kind: "error", text: "That code can't be used. Ask the school for a new one." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-label="Link another child">
      <Card title="Link another child">
        <form className={styles.linkForm} onSubmit={submit}>
          <Input label="Invitation code" hint="From the school, e.g. ABCDE-FGHJK-MNPQR-STVWX" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" required />
          <Button type="submit" loading={busy} disabled={code.trim().length < 20}>
            Link child
          </Button>
        </form>
        {message !== null ? (
          <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? styles.error : styles.ok}>
            {message.text}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
