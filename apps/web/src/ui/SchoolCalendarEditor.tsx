"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, Input, Modal } from "@vidya/ui-system";
import { api, ApiError, type SchoolTermView } from "./api";
import styles from "./SchoolTermsPage.module.css";

function weekdays(from: string, to: string): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let tick = Date.parse(`${from}T00:00:00Z`); tick <= end && dates.length <= 400; tick += 86_400_000) {
    const date = new Date(tick);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

export function SchoolCalendarEditor({ term, admin, onClose }: { term: SchoolTermView; admin: boolean; onClose: () => void }) {
  const [dates, setDates] = useState("");
  const [threshold, setThreshold] = useState("75");
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    api.schoolTermCalendar(term.id).then((calendar) => {
      if (!active) return;
      setDates((calendar.instructionalDays ?? []).join("\n"));
      setThreshold(String(calendar.shortfallThreshold ?? 75));
      setVersion(calendar.version);
    }).catch((caught: unknown) => { if (active) setError(caught instanceof ApiError ? caught.message : "Could not load calendar."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [term.id]);
  const parsed = useMemo(() => dates.split(/[\s,]+/).map((date) => date.trim()).filter(Boolean), [dates]);
  const invalid = parsed.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date < term.startsOn || date > term.endsOn) || new Set(parsed).size !== parsed.length || parsed.length > 400;
  const canSave = admin && term.status === "open" && !loading && !busy && !invalid && Number.isInteger(Number(threshold)) && Number(threshold) >= 0 && Number(threshold) <= 100 && threshold !== "";
  async function save() {
    if (!canSave) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const result = await api.schoolSetTermCalendar(term.id, { instructionalDays: parsed, shortfallThreshold: Number(threshold), expectedVersion: version });
      setVersion(result.version); setDates((result.instructionalDays ?? []).join("\n")); setSaved(true);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not save calendar."); }
    finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title={`${term.name} · instructional days`} footer={<><Button variant="ghost" onClick={onClose}>Done</Button>{admin && term.status === "open" ? <Button loading={busy} disabled={!canSave} onClick={() => void save()}>Save calendar</Button> : null}</>}>
    <div className={styles.calendarEditor}>
      <p className={styles.secondary}>List dates when pupils were expected at school, one per line. Holidays and weekends stay out. The review uses these dates to identify registers that were never submitted.</p>
      {loading ? <p>Loading calendar…</p> : <>
        <div className={styles.rowActions}><strong>{parsed.length} school days</strong>{admin && term.status === "open" ? <Button variant="secondary" size="sm" onClick={() => { setDates(weekdays(term.startsOn, term.endsOn).join("\n")); setSaved(false); }}>Fill weekdays</Button> : null}</div>
        <label className={styles.calendarLabel}>Instructional dates<textarea value={dates} onChange={(event) => { setDates(event.target.value); setSaved(false); }} disabled={!admin || term.status === "closed" || busy} rows={8} placeholder="2026-09-21\n2026-09-22" aria-invalid={invalid} /></label>
        {invalid ? <p className="formerror" role="alert">Use unique, real dates within {term.startsOn}–{term.endsOn} (up to 400).</p> : null}
        <Input label="Shortfall below (%)" type="number" min={0} max={100} step="1" value={threshold} onChange={(event) => { setThreshold(event.target.value); setSaved(false); }} disabled={!admin || term.status === "closed" || busy} />
        {saved ? <p role="status">Calendar saved. Attendance review will use version {version}.</p> : null}
        {term.status === "closed" ? <p className={styles.secondary}>This term is closed. Reopen it with a reason before changing dates.</p> : null}
      </>}
      {error ? <p className="formerror" role="alert">{error}</p> : null}
    </div>
  </Modal>;
}
