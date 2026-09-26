"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, Modal, PageHeader, Select, StatusBadge } from "@vidya/ui-system";
import {
  api, ApiError, currentAcademicYear,
  type GuardianHistoryPolicy, type OrgTree, type ProgressionChoice, type ProgressionPlan, type ProgressionPreview, type ProgressionResult, type SchoolTermView, type StudentView,
} from "./api";
import { HelpButton } from "./help/HelpButton";
import { SchoolSingleExit } from "./SchoolSingleExit";
import styles from "./SchoolProgressionPage.module.css";

type SectionOption = { id: string; label: string; classId: string; collegeId: string };
type Choice = ProgressionChoice | "undecided";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "promote", label: "Promote" },
  { value: "detain", label: "Detain (repeat the standard)" },
  { value: "transfer_out", label: "Transfer out (leaves)" },
  { value: "graduate", label: "Graduate (leaves)" },
  { value: "undecided", label: "Leave undecided" },
];
const OUTCOME_LABEL: Record<ProgressionChoice, string> = { promote: "Promote", detain: "Detain", transfer_out: "Transfer out", graduate: "Graduate" };
const STATUS_LABEL: Record<string, string> = { active: "Active", transferred: "Transferred", alumni: "Alumni", year_back: "Year back", backlog: "Backlog", dropped: "Dropped", inactive: "Inactive" };
const needsReason = (choice: Choice) => choice === "detain" || choice === "transfer_out" || choice === "graduate";

function schoolToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const read = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}
function nextAcademicYear(year: string): string {
  const start = Number(year.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
function sectionsFromTree(tree: OrgTree): SectionOption[] {
  return tree.departments.flatMap((department) => department.classes.flatMap((klass) =>
    klass.sections.map((section) => ({ id: section.id, label: `${klass.name} · ${section.name}`, classId: klass.id, collegeId: tree.college.id }))));
}
const longDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** N6: one-pupil exits and section year-end changes share the audited plan API. */
export function SchoolProgressionPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [sections, setSections] = useState<SectionOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [historyPolicy, setHistoryPolicy] = useState<GuardianHistoryPolicy | null>(null);
  const [historyDraft, setHistoryDraft] = useState("");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [historySaving, setHistorySaving] = useState(false);
  const [roster, setRoster] = useState<StudentView[] | null>(null);
  const [openTerms, setOpenTerms] = useState<SchoolTermView[]>([]);
  const [endsOn, setEndsOn] = useState(schoolToday);
  const [targetYear, setTargetYear] = useState(() => nextAcademicYear(year));
  const [startsOn, setStartsOn] = useState("");
  const [promoteTo, setPromoteTo] = useState("");
  const [detainIn, setDetainIn] = useState("");
  const [choices, setChoices] = useState<Record<string, { outcome: Choice; reason: string }>>({});
  const [preview, setPreview] = useState<{ plan: string; body: ProgressionPreview } | null>(null);
  const [result, setResult] = useState<ProgressionResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState<"year-end" | "single">("year-end");

  useEffect(() => {
    let active = true;
    (async () => {
      const { colleges } = await api.colleges();
      const trees = await Promise.all(colleges.map((college) => api.collegeTree(college.id)));
      if (!active) return;
      const options = trees.flatMap(sectionsFromTree);
      setSections(options);
      setSectionId((current) => current || options[0]?.id || "");
    })().catch((caught: unknown) => {
      if (active) setLoadError(caught instanceof ApiError && caught.status === 403 ? "Only an administrator can close a year." : "Could not load the school's sections.");
    });
    api.schoolTerms(year).then(({ terms }) => { if (active) setOpenTerms(terms.filter((term) => term.status === "open")); }).catch(() => undefined);
    return () => { active = false; };
  }, [year]);

  const source = sections?.find((section) => section.id === sectionId);
  useEffect(() => {
    if (!source?.collegeId) return;
    let active = true;
    setHistoryPolicy(null); setHistoryError(null); setHistoryMessage(null);
    api.guardianHistoryPolicy(source.collegeId).then((policy) => {
      if (active) { setHistoryPolicy(policy); setHistoryDraft(String(policy.days)); }
    }).catch(() => { if (active) setHistoryError("Could not load this school's history window. Reload before recording an exit."); });
    return () => { active = false; };
  }, [source?.collegeId]);
  useEffect(() => {
    if (!sectionId) return;
    let active = true;
    setRoster(null); setPreview(null); setResult(null); setError(null);
    setDetainIn(sectionId); setPromoteTo("");
    api.sectionRoster(sectionId).then(({ students }) => {
      if (!active) return;
      const current = students.filter((student) => student.enrollment?.academicYear === year);
      setRoster(current);
      setChoices(Object.fromEntries(current.map((student) => [student.id, { outcome: "promote" as Choice, reason: "" }])));
    }).catch(() => { if (active) { setRoster([]); setError("Could not load this section's roll."); } });
    return () => { active = false; };
  }, [sectionId, year]);

  const plan: ProgressionPlan | null = useMemo(() => {
    if (!roster || !source) return null;
    const pupils = roster.flatMap((student) => {
      const choice = choices[student.id];
      if (!choice || choice.outcome === "undecided" || !student.enrollment?.id) return [];
      const reason = choice.reason.trim();
      return [{ studentId: student.id, enrollmentId: student.enrollment.id, outcome: choice.outcome, ...(reason ? { reason } : {}) }];
    });
    const continuing = pupils.some((pupil) => pupil.outcome === "promote" || pupil.outcome === "detain");
    return {
      sectionId: source.id, academicYear: year, endsOn, pupils,
      ...(continuing ? { targetAcademicYear: targetYear, ...(startsOn ? { startsOn } : {}) } : {}),
      ...(pupils.some((pupil) => pupil.outcome === "promote") && promoteTo ? { promoteToSectionId: promoteTo } : {}),
      ...(pupils.some((pupil) => pupil.outcome === "detain") && detainIn ? { detainInSectionId: detainIn } : {}),
    };
  }, [roster, source, choices, year, endsOn, targetYear, startsOn, promoteTo, detainIn]);
  const planKey = plan ? JSON.stringify(plan) : "";
  const current = preview !== null && preview.plan === planKey ? preview.body : null;

  function choose(studentId: string, patch: Partial<{ outcome: Choice; reason: string }>) {
    setChoices((all) => ({ ...all, [studentId]: { ...all[studentId]!, ...patch } }));
    setResult(null);
  }

  async function runPreview() {
    if (!plan || plan.pupils.length === 0) return;
    setBusy("preview"); setError(null); setResult(null);
    try { setPreview({ plan: planKey, body: await api.progressionPreview(plan) }); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not preview these changes."); }
    finally { setBusy(null); }
  }

  async function apply() {
    if (!plan || !current?.ready) return;
    setConfirming(false); setBusy("apply"); setError(null);
    try {
      setResult(await api.progressionApply({ ...plan, ...(current.familyAccess ? { expectedHistoryPolicyVersion: current.familyAccess.policyVersion } : {}) }));
      setPreview(null);
      const { students } = await api.sectionRoster(plan.sectionId);
      const remaining = students.filter((student) => student.enrollment?.academicYear === year);
      setRoster(remaining);
      setChoices(Object.fromEntries(remaining.map((student) => [student.id, { outcome: "undecided" as Choice, reason: "" }])));
    } catch (caught) {
      setError(caught instanceof ApiError ? `${caught.message} Preview again before applying.` : "Nothing was applied. Preview again.");
      setPreview(null);
    } finally { setBusy(null); }
  }

  if (loadError) return <EmptyState title="Promotion and exits are unavailable." body={loadError} />;
  const sectionLabel = (id: string | null) => sections?.find((section) => section.id === id)?.label ?? "—";
  const otherStandards = (sections ?? []).filter((section) => source && section.classId !== source.classId);
  const sameStandard = (sections ?? []).filter((section) => source && section.classId === source.classId);
  const decided = plan?.pupils.length ?? 0;
  const continuing = plan?.pupils.some((pupil) => pupil.outcome === "promote" || pupil.outcome === "detain") ?? false;
  const missingReason = roster?.some((student) => needsReason(choices[student.id]?.outcome ?? "undecided") && !choices[student.id]?.reason.trim()) ?? false;
  const counts = current ? CHOICES.slice(0, 4).map((choice) => ({ ...choice, n: current.pupils.filter((pupil) => pupil.outcome === choice.value).length })).filter((row) => row.n > 0) : [];
  const validHistoryDays = /^\d{1,3}$/.test(historyDraft) && Number(historyDraft) <= 365;

  async function saveHistoryPolicy() {
    if (!source || !historyPolicy || !validHistoryDays || historySaving) return;
    setHistorySaving(true); setHistoryError(null); setHistoryMessage(null);
    try {
      const saved = await api.updateGuardianHistoryPolicy(source.collegeId, { days: Number(historyDraft), expectedVersion: historyPolicy.version });
      setHistoryPolicy(saved); setHistoryDraft(String(saved.days)); setPreview(null);
      setHistoryMessage("History window saved for future exits. Existing exit dates are unchanged.");
    } catch (caught) {
      setHistoryError(caught instanceof ApiError ? caught.message : "Could not save the history window.");
      if (caught instanceof ApiError && caught.status === 409) {
        const latest = await api.guardianHistoryPolicy(source.collegeId).catch(() => null);
        if (latest) { setHistoryPolicy(latest); setHistoryDraft(String(latest.days)); setPreview(null); }
      }
    } finally { setHistorySaving(false); }
  }

  async function refreshAfterSingleExit() {
    try {
      const { students } = await api.sectionRoster(sectionId);
      const remaining = students.filter((student) => student.enrollment?.academicYear === year);
      setRoster(remaining);
      setChoices(Object.fromEntries(remaining.map((student) => [student.id, { outcome: "undecided" as Choice, reason: "" }])));
      setPreview(null);
    } catch {
      setRoster(null);
      throw new Error("The roll could not be reloaded after the exit was recorded.");
    }
  }

  return <>
    <PageHeader eyebrow="Students" title="Promotion and exits"
      lede="Record one pupil's exit or close a section's year. Preview each change before applying; the original enrollment remains in history."
      help={<HelpButton slug="progression" />} />

    <div className={styles.modeSwitch} role="group" aria-label="Progression workflow">
      <Button variant={mode === "single" ? "primary" : "secondary"} onClick={() => setMode("single")}>One pupil exit</Button>
      <Button variant={mode === "year-end" ? "primary" : "secondary"} onClick={() => setMode("year-end")}>Year-end section</Button>
    </div>

    {mode === "single" ? <SchoolSingleExit
      sections={sections ?? []} sectionId={sectionId} onSectionChange={setSectionId}
      roster={roster} year={year} historyPolicy={historyPolicy}
      openTermNames={openTerms.map((term) => term.name)} onApplied={refreshAfterSingleExit}
    /> : <>

    <Card title="1. Section and dates">
      <div className={styles.filters}>
        <Select label="Section" value={sectionId} disabled={historySaving} onChange={(event) => setSectionId(event.target.value)}
          options={(sections ?? []).map((section) => ({ value: section.id, label: section.label }))} />
        <label className={styles.field}>Last day of {year}<input type="date" value={endsOn} max={schoolToday()} onChange={(event) => setEndsOn(event.target.value)} /><small>Also the leaving date for pupils who leave.</small></label>
        {continuing ? <>
          <label className={styles.field}>Next academic year<input value={targetYear} onChange={(event) => setTargetYear(event.target.value)} pattern="\d{4}-\d{2}" /></label>
          <label className={styles.field}>New year starts<input type="date" value={startsOn} min={endsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
        </> : null}
      </div>
      {continuing ? <div className={styles.filters}>
        <Select label="Promote into" value={promoteTo} onChange={(event) => setPromoteTo(event.target.value)}
          options={[{ value: "", label: "Choose a section of the next standard…" }, ...otherStandards.map((section) => ({ value: section.id, label: section.label }))]} />
        <Select label="Detained pupils repeat in" value={detainIn} onChange={(event) => setDetainIn(event.target.value)}
          options={sameStandard.map((section) => ({ value: section.id, label: section.label }))} />
      </div> : null}
      {openTerms.length > 0 ? <p className={styles.warning} role="status">
        {openTerms.map((term) => term.name).join(", ")} {openTerms.length === 1 ? "is" : "are"} still open for {year}. Finish marks and report cards first: once promoted or gone, pupils leave this section's live roll and marks can no longer be entered for them here.
      </p> : null}
      <div className={styles.policy}>
        <div><strong>Guardian history after exit</strong><p className={styles.hint}>For future transfers and graduations, families can read earlier attendance and published report cards for this many days after live access ends. Zero closes access immediately. Existing exit dates do not change.</p></div>
        <div className={styles.policyForm}>
          <label className={styles.field}>Days after exit<input type="number" min={0} max={365} step={1} inputMode="numeric" value={historyDraft} disabled={!historyPolicy || historySaving} onChange={(event) => { setHistoryDraft(event.target.value); setHistoryMessage(null); }} /></label>
          <Button variant="secondary" loading={historySaving} disabled={!historyPolicy || !validHistoryDays || Number(historyDraft) === historyPolicy.days} onClick={() => void saveHistoryPolicy()}>Save window</Button>
        </div>
        {historyError ? <p className={styles.error} role="alert">{historyError}</p> : null}
        {historyMessage ? <p role="status">{historyMessage}</p> : null}
      </div>
    </Card>

    <Card title="2. Decide each pupil" actions={roster && roster.length > 0 ? <Select label="Set every pupil to" value="" onChange={(event) => {
      const outcome = event.target.value as Choice;
      if (outcome) setChoices((all) => Object.fromEntries(Object.entries(all).map(([id, choice]) => [id, { ...choice, outcome }])));
    }} options={[{ value: "", label: "Choose…" }, ...CHOICES]} /> : undefined}>
      {roster === null ? <p className={styles.hint}>Loading the roll…</p>
        : roster.length === 0 ? <EmptyState title={`No pupils on this section's ${year} roll.`} body="Pupils already promoted or gone no longer appear here; their records stay on the pupil page." />
        : <div className={styles.tableScroll}><table className={styles.table}>
          <thead><tr><th scope="col">Pupil</th><th scope="col">Outcome</th><th scope="col">Reason</th></tr></thead>
          <tbody>{roster.map((student) => {
            const choice = choices[student.id] ?? { outcome: "undecided" as Choice, reason: "" };
            return <tr key={student.id}>
              <td><a href={`/students/${encodeURIComponent(student.id)}`}>{student.fullName}</a><small>{student.admissionNo} · {STATUS_LABEL[student.status] ?? student.status}</small></td>
              <td><select aria-label={`Outcome for ${student.fullName}`} value={choice.outcome} onChange={(event) => choose(student.id, { outcome: event.target.value as Choice })}>
                {CHOICES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></td>
              <td>{needsReason(choice.outcome) || choice.reason
                ? <input aria-label={`Reason for ${student.fullName}`} value={choice.reason} maxLength={240} required={needsReason(choice.outcome)}
                  placeholder={choice.outcome === "detain" ? "Why the pupil repeats" : "Reason for leaving"} onChange={(event) => choose(student.id, { reason: event.target.value })} />
                : <span className={styles.hint}>Not needed</span>}</td>
            </tr>;
          })}</tbody>
        </table></div>}
      <div className={styles.bar}>
        <p>{decided} of {roster?.length ?? 0} pupils decided{missingReason ? " · a reason is still missing" : ""}.</p>
        <Button onClick={() => void runPreview()} loading={busy === "preview"} disabled={decided === 0 || busy !== null}>Preview changes</Button>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </Card>

    {current ? <Card title="3. Check and apply">
      <div className={styles.chips}>
        {counts.map((row) => <span key={row.value}><strong>{row.n}</strong> {OUTCOME_LABEL[row.value as ProgressionChoice]}</span>)}
        {current.undecided.length > 0 ? <span><strong>{current.undecided.length}</strong> undecided, unchanged</span> : null}
      </div>
      {current.familyAccess ? <p className={styles.notice}>
        Families of leaving pupils keep live access through {longDate(current.endsOn)}. {current.familyAccess.days === 0
          ? "After that, family access closes immediately."
          : `After that they can read attendance and published report cards as they stood on that day for ${current.familyAccess.days} days, through ${longDate(new Date(Date.parse(current.familyAccess.historicalAccessUntil) - 1).toISOString())}.`} Unused invitation codes are cancelled.
      </p> : null}
      {current.problems.length > 0 ? <ul className={styles.problems} role="alert">{current.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
      <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th scope="col">Pupil</th><th scope="col">Outcome</th><th scope="col">Status</th><th scope="col">{current.targetAcademicYear ?? "Next year"}</th><th scope="col">Family links ending</th><th scope="col">Check</th></tr></thead>
        <tbody>{current.pupils.map((pupil) => <tr key={pupil.studentId}>
          <td>{pupil.fullName}<small>{pupil.admissionNo}</small></td>
          <td>{OUTCOME_LABEL[pupil.outcome]}{pupil.reason ? <small>{pupil.reason}</small> : null}</td>
          <td>{STATUS_LABEL[pupil.statusBefore] ?? pupil.statusBefore} → {STATUS_LABEL[pupil.statusAfter] ?? pupil.statusAfter}</td>
          <td>{pupil.targetSectionId ? `${sectionLabel(pupil.targetSectionId)} from ${current.startsOn ?? "—"}` : "Leaves the school"}</td>
          <td>{pupil.outcome === "transfer_out" || pupil.outcome === "graduate" ? pupil.familyLinks : "—"}</td>
          <td>{pupil.problems.length === 0 ? <StatusBadge status="good">Ready</StatusBadge> : pupil.problems.map((problem) => <StatusBadge key={problem} status="danger">{problem}</StatusBadge>)}</td>
        </tr>)}</tbody>
      </table></div>
      <div className={styles.bar}>
        <p>{current.ready ? `This changes ${current.pupils.length} pupils in one step. If anything changed since this preview, nothing is applied.` : "Fix the problems above, then preview again."}</p>
        <Button variant="danger" onClick={() => setConfirming(true)} disabled={!current.ready || busy !== null} loading={busy === "apply"}>Apply to {current.pupils.length} pupils</Button>
      </div>
    </Card> : null}

    {result ? <Card title="Applied">
      <p className={styles.notice} role="status">Recorded for {result.pupils.length} pupils. Each pupil's page now shows the outcome in its history. Batch reference {result.runId}.</p>
      <ul className={styles.outcomes}>{result.pupils.map((pupil) => {
        const name = result.preview.pupils.find((row) => row.studentId === pupil.studentId)?.fullName ?? pupil.studentId;
        return <li key={pupil.studentId}><a href={`/students/${encodeURIComponent(pupil.studentId)}`}>{name}</a> — {OUTCOME_LABEL[result.preview.pupils.find((row) => row.studentId === pupil.studentId)?.outcome ?? "promote"]}{pupil.familyAccessChanged > 0 ? `, ${pupil.familyAccessChanged} family link${pupil.familyAccessChanged === 1 ? "" : "s"} moved to read-only` : ""}</li>;
      })}</ul>
    </Card> : null}

    <Modal open={confirming} onClose={() => setConfirming(false)} title="Apply these changes?"
      footer={<><Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button><Button variant="danger" onClick={() => void apply()}>Apply now</Button></>}>
      <p>This closes {year} for {current?.pupils.length ?? 0} pupils of {source?.label ?? "this section"}. Their records are kept; each change is audited. Undoing a pupil's outcome is not yet available on this page.</p>
    </Modal>
    </>}
  </>;
}
