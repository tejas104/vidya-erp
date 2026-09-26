"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, currentAcademicYear, type FeeCollectionSummary, type FeeInvoiceView, type Session } from "@/ui/api";
import { Button, EmptyState, Input, PageHeader, Skeleton } from "@vidya/ui-system";
import { DeniedState } from "@/ui/DeniedState";
import { formatPaise } from "@/ui/money";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default function AccountingPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [range, setRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [session, setSession] = useState<Session | null>(null);
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [summary, setSummary] = useState<FeeCollectionSummary | null>(null);
  const [dues, setDues] = useState<FeeInvoiceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const allowed = session?.roles.some((role) => role === "accountant" || role === "admin" || role === "principal");

  useEffect(() => {
    let alive = true;
    Promise.all([api.session(), api.colleges()]).then(([me, result]) => {
      if (!alive) return;
      setSession(me);
      const school = result.colleges[0];
      if (school) { setCollegeId(school.id); setSchoolName(school.name); }
      else setError("No school is available to this account.");
    }).catch(() => { if (alive) setError("Could not open the accounting workspace. Try again."); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!collegeId || !allowed) return;
    let alive = true;
    setError(null);
    Promise.all([
      api.feesCollectionSummary(collegeId, range.from, range.to),
      api.feesDefaulters(collegeId, year),
    ]).then(([collections, outstanding]) => {
      if (!alive) return;
      setSummary(collections);
      setDues(outstanding.defaulters);
    }).catch(() => { if (alive) setError("Could not load collections and outstanding invoices. Retry this view."); });
    return () => { alive = false; };
  }, [collegeId, allowed, range, year, reload]);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!from || !to || from > to) { setError("Choose a valid date range."); return; }
    setRange({ from, to });
  }

  const totalDue = dues?.reduce((sum, invoice) => sum + invoice.duesPaise, 0) ?? 0;
  const pupilCount = new Set(dues?.map((invoice) => invoice.studentId) ?? []).size;
  const largestDues = [...(dues ?? [])].sort((a, b) => b.duesPaise - a.duesPaise).slice(0, 8);

  return <>
    <PageHeader eyebrow="Money · school office" title="Accounting desk"
      lede="One place to reconcile collections, follow outstanding invoices and reach the fee counter."
      actions={allowed ? <a className="btn" href="/manage/fees">Open fee counter</a> : undefined} />
    {session && !allowed ? <DeniedState title="Accounting is outside your role." /> : null}
    {allowed ? <>
      <div className={styles.context}><strong>{schoolName}</strong><span>Academic year {year}</span></div>
      <form className={styles.range} onSubmit={applyRange} aria-label="Collection date range">
        <Input id="accounting-from" type="date" label="Collections from" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input id="accounting-to" type="date" label="Through" value={to} onChange={(event) => setTo(event.target.value)} />
        <Button type="submit">Show collections</Button>
        <Button type="button" variant="ghost" onClick={() => setReload((value) => value + 1)}>Refresh</Button>
      </form>
      {error ? <div className="state" role="alert">{error}</div> : null}
      {!error && (!summary || !dues) ? <div className={styles.loading} aria-label="Loading accounting figures"><Skeleton height={104} /><Skeleton height={200} /></div> : null}
      {summary && dues ? <>
        <div className={styles.figures} aria-label="Accounting figures">
          <div><span>Collected in selected dates</span><strong className="num">{formatPaise(summary.totalPaise)}</strong><small>From issued payment receipts</small></div>
          <div><span>Outstanding in {year}</span><strong className="num">{formatPaise(totalDue)}</strong><small>{dues.length} invoices across {pupilCount} pupils</small></div>
          <div><span>Payment channels</span><strong className="num">{summary.byMode.filter((mode) => mode.count > 0).length}</strong><small>Modes used in selected dates</small></div>
        </div>
        <div className={styles.workGrid}>
          <section className={styles.panel} aria-label="Collections by payment mode">
            <div className={styles.panelHead}><h2>Collections by mode</h2><span>{range.from} to {range.to}</span></div>
            {summary.byMode.length === 0 || summary.totalPaise === 0 ? <EmptyState title="No receipts in this range." body="Try a wider date range or take a payment at the fee counter." /> :
              <div className={styles.modes}>{summary.byMode.filter((mode) => mode.count > 0).map((mode) => <div key={mode.mode} className={styles.mode}>
                <div><strong>{mode.mode}</strong><span className="num">{formatPaise(mode.totalPaise)} · {mode.count} receipts</span></div>
                <div className={styles.track}><span style={{ width: `${Math.max(2, mode.totalPaise / summary.totalPaise * 100)}%` }} /></div>
              </div>)}</div>}
          </section>
          <section className={styles.panel} aria-label="Outstanding invoices">
            <div className={styles.panelHead}><h2>Highest outstanding dues</h2><a href="/manage/fees">Open all dues</a></div>
            {largestDues.length === 0 ? <EmptyState title="No outstanding invoices." /> :
              <ol className={styles.dues}>{largestDues.map((invoice) => <li key={invoice.id}>
                <a href={`/students/${encodeURIComponent(invoice.studentId)}?tab=finance`}>{invoice.studentName}</a>
                <span>{invoice.headName} · due {invoice.dueOn}</span>
                <strong className="num">{formatPaise(invoice.duesPaise)}</strong>
              </li>)}</ol>}
          </section>
        </div>
        <nav className={styles.next} aria-label="Accounting tasks">
          <a href="/manage/fees">{session?.roles.includes("accountant") || session?.roles.includes("admin") ? "Take a payment and issue a receipt" : "Review the fee counter"} <span aria-hidden="true">→</span></a>
          <a href={session?.roles.includes("accountant") && !session.roles.includes("admin") ? "/manage/directory" : "/manage/students"}>Look up a pupil record <span aria-hidden="true">→</span></a>
          <a href="/manage/reports">Review generated reports <span aria-hidden="true">→</span></a>
          {session?.roles.includes("admin") ? <a href="/manage/users">Manage accountant access <span aria-hidden="true">→</span></a> : null}
        </nav>
      </> : null}
    </> : null}
    {!session && !error ? <Skeleton height={180} /> : null}
  </>;
}
