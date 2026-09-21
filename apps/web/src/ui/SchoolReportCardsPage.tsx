"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, Modal, PageHeader, Select, Skeleton, StatusBadge } from "@vidya/ui-system";
import { ApiError, api, currentAcademicYear, type OrgTree, type SchoolReportCardPreview, type SchoolReportCardRosterStudent, type SchoolTermView } from "./api";
import { HelpButton } from "./help/HelpButton";
import styles from "./SchoolReportCardsPage.module.css";

type LoadState = "loading" | "ready" | "denied" | "error";
type RosterState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; students: SchoolReportCardRosterStudent[] } | { kind: "denied" } | { kind: "error" };

function incomplete(preview: SchoolReportCardPreview): boolean {
  return !preview.overall.complete || !preview.attendance.complete || preview.subjects.some((subject) => !subject.complete);
}
function errorState(error: unknown): "denied" | "error" { return error instanceof ApiError && error.status === 403 ? "denied" : "error"; }
function percent(value: number | null): string { return value === null ? "Not available" : `${value.toFixed(1)}%`; }

export function SchoolReportCardsPage() {
  const [load, setLoad] = useState<LoadState>("loading");
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [terms, setTerms] = useState<SchoolTermView[]>([]);
  const [year, setYear] = useState(currentAcademicYear);
  const [termId, setTermId] = useState("");
  const [classId, setClassId] = useState("");
  const [roster, setRoster] = useState<RosterState>({ kind: "idle" });
  const [selected, setSelected] = useState<SchoolReportCardRosterStudent | null>(null);
  const [preview, setPreview] = useState<SchoolReportCardPreview | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "denied" | "error">("idle");
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { colleges } = await api.colleges();
        if (!colleges[0]) throw new Error("No school is available.");
        const [nextTree, termResponse] = await Promise.all([api.collegeTree(colleges[0].id), api.schoolTerms()]);
        if (!active) return;
        setTree(nextTree); setTerms(termResponse.terms); setLoad("ready");
      } catch (error) { if (active) setLoad(errorState(error)); }
    })();
    return () => { active = false; };
  }, []);

  const years = useMemo(() => Array.from(new Set([year, ...terms.map((term) => term.academicYear)])).sort().reverse(), [year, terms]);
  const visibleTerms = terms.filter((term) => term.academicYear === year);
  const classes = tree?.departments.flatMap((department) => department.classes) ?? [];

  useEffect(() => {
    if (termId !== "" && !visibleTerms.some((term) => term.id === termId)) setTermId("");
  }, [termId, visibleTerms]);

  async function loadRoster(nextClassId = classId, nextTermId = termId) {
    if (!nextClassId || !nextTermId) { setRoster({ kind: "idle" }); return; }
    setRoster({ kind: "loading" }); setSelected(null); setPreview(null); setPreviewState("idle"); setActionError(null);
    try { setRoster({ kind: "ready", students: (await api.schoolReportCardRoster(nextClassId, nextTermId)).students }); }
    catch (error) { setRoster({ kind: errorState(error) }); }
  }
  async function openPreview(student: SchoolReportCardRosterStudent) {
    if (!termId) return;
    setSelected(student); setPreview(null); setPreviewState("loading"); setActionError(null);
    try { setPreview(await api.schoolReportCardPreview({ studentId: student.studentId, termId })); setPreviewState("idle"); }
    catch (error) { setPreviewState(errorState(error)); }
  }
  async function generate() {
    if (!selected || !preview || generating) return;
    setGenerating(true); setActionError(null);
    try {
      const generated = await api.schoolGenerateReportCard({ studentId: selected.studentId, termId });
      const update = (student: SchoolReportCardRosterStudent) => student.studentId === selected.studentId ? { ...student, snapshotId: generated.snapshotId, generatedAt: generated.generatedAt } : student;
      setSelected((student) => student === null ? null : update(student)); setRoster((state) => state.kind === "ready" ? { ...state, students: state.students.map(update) } : state);
      setConfirmIncomplete(false);
    } catch (error) { setActionError(error instanceof ApiError ? error.message : "Could not generate this report card. Try again."); }
    finally { setGenerating(false); }
  }

  if (load === "loading") return <Skeleton height={18} />;
  if (load === "denied") return <EmptyState title="Report cards are restricted." body="Ask a school administrator for report-card access." />;
  if (load === "error" || tree === null) return <EmptyState title="Couldn't load report cards." body="Check the connection, then retry." action={{ label: "Retry", onClick: () => window.location.reload() }} />;

  return <>
    <PageHeader eyebrow="School records" title="Report card desk" lede="Review one student at a time before creating a permanent report-card snapshot." help={<HelpButton slug="report-cards" />} />
    <div className={styles.filters}><Card>
      <Select id="report-year" label="Academic Year" value={year} onChange={(event) => { setYear(event.target.value); setTermId(""); setRoster({ kind: "idle" }); }} options={years.map((value) => ({ value, label: value }))} />
      <Select id="report-term" label="Term" value={termId} onChange={(event) => { setTermId(event.target.value); void loadRoster(classId, event.target.value); }} options={[{ value: "", label: visibleTerms.length ? "Choose a term…" : "No terms for this year" }, ...visibleTerms.map((term) => ({ value: term.id, label: term.name }))]} />
      <Select id="report-class" label="Class" value={classId} onChange={(event) => { setClassId(event.target.value); void loadRoster(event.target.value, termId); }} options={[{ value: "", label: "Choose a class…" }, ...classes.map((item) => ({ value: item.id, label: item.name }))]} />
    </Card></div>
    <section className={styles.workspace} aria-label="Report card workspace">
      <div className={styles.roster}><Card>
        <div className="section-head"><h2>Students</h2>{roster.kind === "ready" ? <span className="subtle">{roster.students.length} enrolled</span> : null}</div>
        {roster.kind === "idle" ? <EmptyState title="Choose a term and class." body="The roster and existing snapshots appear here." /> : null}
        {roster.kind === "loading" ? <Skeleton height={18} /> : null}
        {roster.kind === "denied" ? <EmptyState title="This class is outside your access." body="Choose a class you are authorized to manage." /> : null}
        {roster.kind === "error" ? <EmptyState title="Couldn't load this roster." body="Your selections are preserved." action={{ label: "Retry", onClick: () => void loadRoster() }} /> : null}
        {roster.kind === "ready" && roster.students.length === 0 ? <EmptyState title="No enrolled students." body="There are no report cards to prepare for this selection." /> : null}
        {roster.kind === "ready" ? <div className={styles.studentList}>{roster.students.map((student) => <button key={student.studentId} type="button" className={selected?.studentId === student.studentId ? styles.studentActive : styles.student} onClick={() => void openPreview(student)}><span><strong>{student.fullName}</strong><small>{student.admissionNo}</small></span>{student.snapshotId ? <StatusBadge status="good">Generated</StatusBadge> : <StatusBadge status="neutral">Not generated</StatusBadge>}</button>)}</div> : null}
      </Card></div>
      <div className={styles.preview}><Card>
        <div className="section-head"><h2>Report-card preview</h2>{preview ? <StatusBadge status={incomplete(preview) ? "warn" : "good"}>{incomplete(preview) ? "Needs review" : "Complete"}</StatusBadge> : null}</div>
        {selected === null ? <EmptyState title="Select a student." body="Their marks and attendance will be shown without inventing missing values." /> : null}
        {previewState === "loading" ? <><Skeleton height={24} /><div className={styles.actions}><Button disabled>Generate report card</Button></div></> : null}
        {previewState === "denied" ? <EmptyState title="You can't preview this student." body="Choose a student within your authorized class." /> : null}
        {previewState === "error" ? <EmptyState title="Couldn't load the preview." body="Your term, class, and student stay selected." action={{ label: "Retry", onClick: () => { if (selected) void openPreview(selected); } }} /> : null}
        {preview ? <div className={styles.previewBody}><div className={styles.identity}><div><strong>{preview.student.fullName}</strong><span>{preview.student.admissionNo}</span></div><span>{preview.term.name} · {preview.term.academicYear}</span></div><div className={styles.subjects}>{preview.subjects.map((subject) => <div key={subject.subjectId} className={styles.subject}><span>{subject.subjectName}</span><span>{subject.complete ? `${percent(subject.percentage)} · ${subject.grade ?? "No grade"}` : "Incomplete marks"}</span></div>)}</div><div className={styles.summary}><div><span>Overall</span><strong>{preview.overall.complete ? `${percent(preview.overall.percentage)} · ${preview.overall.grade ?? "No grade"}` : "Incomplete"}</strong></div><div><span>Attendance</span><strong>{preview.attendance.complete ? percent(preview.attendance.percentage) : "Incomplete"}</strong><small>{preview.attendance.presentEquivalentDays === null ? "No present-equivalent total" : `${preview.attendance.presentEquivalentDays}/${preview.attendance.eligibleDays} eligible days`}</small></div></div>{(incomplete(preview) || preview.warnings.length > 0) ? <div className={styles.warnings} role="alert"><strong>Review before generating</strong><ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}{preview.attendance.missingDates.length ? <li>Attendance is missing for {preview.attendance.missingDates.join(", ")}.</li> : null}</ul></div> : null}{actionError ? <p className="formerror" role="alert">{actionError}</p> : null}<div className={styles.actions}>{selected?.snapshotId ? <a className="ui-btn ui-btn-primary" href={api.schoolReportCardDownloadUrl(selected.snapshotId)}>Download PDF</a> : null}<Button onClick={() => incomplete(preview) ? setConfirmIncomplete(true) : void generate()} disabled={generating} loading={generating}>{selected?.snapshotId ? "Generate new snapshot" : "Generate report card"}</Button></div></div> : null}
      </Card></div>
    </section>
    <Modal open={confirmIncomplete} onClose={() => setConfirmIncomplete(false)} title="Generate with incomplete data" footer={<><Button variant="ghost" onClick={() => setConfirmIncomplete(false)}>Cancel</Button><Button onClick={() => void generate()} loading={generating}>Generate with warnings</Button></>}><p>This preview has missing marks or attendance. Generating records the data exactly as shown; it does not treat missing values as zero or assume an attendance or promotion threshold.</p></Modal>
  </>;
}
