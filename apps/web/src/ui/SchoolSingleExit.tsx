"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, Modal, Select, StatusBadge } from "@vidya/ui-system";
import { api, ApiError, type GuardianHistoryPolicy, type ProgressionPlan, type ProgressionPreview, type ProgressionResult, type StudentView } from "./api";
import styles from "./SchoolProgressionPage.module.css";

type SectionOption = { id: string; label: string };
type ExitOutcome = "transfer_out" | "graduate";

function schoolToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const read = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function longDate(value: string): string {
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
    .toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function statusLabel(value: string): string {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function SchoolSingleExit({
  sections, sectionId, onSectionChange, roster, year, historyPolicy, openTermNames, onApplied,
}: {
  sections: SectionOption[];
  sectionId: string;
  onSectionChange: (sectionId: string) => void;
  roster: StudentView[] | null;
  year: string;
  historyPolicy: GuardianHistoryPolicy | null;
  openTermNames: string[];
  onApplied: () => Promise<void>;
}) {
  const [studentId, setStudentId] = useState("");
  const [outcome, setOutcome] = useState<ExitOutcome>("transfer_out");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ key: string; body: ProgressionPreview } | null>(null);
  const [result, setResult] = useState<ProgressionResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStudentId(""); setReason(""); setPreview(null); setResult(null); setError(null);
  }, [sectionId]);

  const student = roster?.find((row) => row.id === studentId && row.enrollment?.sectionId === sectionId);
  const endsOn = schoolToday();
  const plan: ProgressionPlan | null = useMemo(() => student?.enrollment?.id ? {
    workflow: "single_exit", sectionId, academicYear: year, endsOn,
    pupils: [{ studentId: student.id, enrollmentId: student.enrollment.id, outcome, reason: reason.trim() }],
  } : null, [student, sectionId, year, endsOn, outcome, reason]);
  const key = plan ? JSON.stringify([plan, historyPolicy?.version]) : "";
  const current = preview?.key === key ? preview.body : null;
  const pupil = current?.pupils[0];

  async function runPreview() {
    if (!plan) return;
    setBusy("preview"); setError(null); setResult(null);
    try { setPreview({ key, body: await api.progressionPreview(plan) }); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not preview this exit."); }
    finally { setBusy(null); }
  }

  async function apply() {
    if (!plan || !current?.ready || !current.familyAccess) return;
    setConfirming(false); setBusy("apply"); setError(null);
    try {
      const applied = await api.progressionApply({ ...plan, expectedHistoryPolicyVersion: current.familyAccess.policyVersion });
      setResult(applied); setPreview(null); setStudentId(""); setReason("");
      try { await onApplied(); }
      catch { setError("The exit was recorded, but the roll could not reload. Refresh the page before another change."); }
    } catch (caught) {
      setError(caught instanceof ApiError ? `${caught.message} Preview again before applying.` : "Nothing was applied. Preview again.");
      setPreview(null);
    } finally { setBusy(null); }
  }

  return <>
    <Card title="Record one pupil's exit">
      <p className={styles.hint}>Use this for a transfer or graduation during the school year. The pupil leaves the live roll after the recorded leaving day. Preview the effect on family access before you apply.</p>
      <div className={styles.filters}>
        <Select label="Section" value={sectionId} onChange={(event) => onSectionChange(event.target.value)}
          options={sections.map((section) => ({ value: section.id, label: section.label }))} />
        <Select label="Pupil" value={studentId} onChange={(event) => { setStudentId(event.target.value); setResult(null); }}
          options={[{ value: "", label: "Choose a pupil…" }, ...(roster ?? []).map((row) => ({ value: row.id, label: `${row.fullName} · ${row.admissionNo}` }))]} />
        <Select label="Exit outcome" value={outcome} onChange={(event) => { setOutcome(event.target.value as ExitOutcome); setResult(null); }}
          options={[{ value: "transfer_out", label: "Transfer out" }, { value: "graduate", label: "Graduate" }]} />
        <div className={styles.field}><span>Last day at school</span><strong>{longDate(endsOn)} (today)</strong></div>
      </div>
      <label className={styles.field}>Reason for leaving
        <input value={reason} maxLength={240} required placeholder="Record the reason for this exit"
          onChange={(event) => { setReason(event.target.value); setResult(null); }} />
      </label>
      {openTermNames.length > 0 ? <p className={styles.warning} role="status">
        {openTermNames.join(", ")} {openTermNames.length === 1 ? "is" : "are"} still open. Review marks and report cards before applying; the pupil will leave this section's live roll.
      </p> : null}
      {historyPolicy ? <p className={styles.hint}>This school's current guardian history window is {historyPolicy.days} days after live access ends. The preview shows the exact dates.</p> : null}
      {roster?.length === 0 ? <EmptyState title="No pupils on this section's live roll." /> : null}
      <div className={styles.bar}>
        <p>Only the selected pupil will change. Other pupils stay on the roll.</p>
        <Button onClick={() => void runPreview()} loading={busy === "preview"}
          disabled={!plan || !reason.trim() || busy !== null}>Preview exit</Button>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </Card>

    {current ? <Card title="Check this exit">
      {pupil ? <p><strong>{pupil.fullName}</strong> · {pupil.admissionNo} · {statusLabel(pupil.statusBefore)} → {statusLabel(pupil.statusAfter)}<br />Reason: {pupil.reason}</p> : null}
      <p>Leaving day: {longDate(current.endsOn)}. {pupil?.familyLinks ?? 0} family link{pupil?.familyLinks === 1 ? "" : "s"} will change. Pending invitation codes will be revoked.</p>
      {current.familyAccess ? <p className={styles.notice}>Family live access continues through {longDate(current.endsOn)}. {current.familyAccess.days === 0
        ? "Historical family access closes after that day."
        : `Earlier attendance and published report cards stay readable for ${current.familyAccess.days} days, through ${longDate(new Date(Date.parse(current.familyAccess.historicalAccessUntil) - 1).toISOString())}.`}</p> : null}
      {current.problems.length > 0 || pupil?.problems.length ? <ul className={styles.problems} role="alert">
        {[...current.problems, ...(pupil?.problems ?? [])].map((problem) => <li key={problem}>{problem}</li>)}
      </ul> : null}
      <div className={styles.bar}>
        <StatusBadge status={current.ready ? "good" : "danger"}>{current.ready ? "Ready to apply" : "Resolve the problems and preview again"}</StatusBadge>
        <Button variant="danger" disabled={!current.ready || !current.familyAccess || busy !== null}
          onClick={() => setConfirming(true)}>Apply this exit</Button>
      </div>
    </Card> : null}

    {result ? <Card title="Exit recorded">
      <p role="status">The pupil's exit is recorded and audited. The original enrollment remains in their history. Reference {result.runId}.</p>
      <a href={`/students/${encodeURIComponent(result.pupils[0]!.studentId)}?tab=history`}>View pupil history</a>
    </Card> : null}

    <Modal open={confirming} onClose={() => setConfirming(false)} title="Record this pupil's exit?"
      footer={<><Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button><Button variant="danger" onClick={() => void apply()}>Record exit</Button></>}>
      <p>This ends {student?.fullName ?? "the pupil"}'s live enrollment after {longDate(endsOn)}, updates family access, revokes unused invitation codes, and records an audit event. Other pupils remain on the roll.</p>
    </Modal>
  </>;
}
