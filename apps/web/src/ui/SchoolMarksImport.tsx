"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Button, Card } from "@vidya/ui-system";
import { api, type SchoolMarkView } from "./api";
import type { ScoreEntryStudent } from "./ScoreEntryCard";
import { marksCsvErrorReport, marksCsvTemplate, previewMarksCsv, type CsvPreview } from "./schoolMarksCsv";
import styles from "./SchoolMarksImport.module.css";

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  assessmentId: string;
  roster: ScoreEntryStudent[];
  marks: SchoolMarkView[];
  maxScore: number;
  saving: boolean;
  onSave: (entries: { studentId: string; score: number; expectedScore: number | null }[]) => Promise<boolean>;
}

/** Preview first, then submit only changed rows to the existing audited batch API. */
export function SchoolMarksImport({ assessmentId, roster, marks, maxScore, saving, onSave }: Props) {
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  function showError(message: string) {
    setError(message);
    window.setTimeout(() => alertRef.current?.focus(), 0);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null);
    setError(null);
    setFilename(file?.name ?? "");
    if (!file) return;
    if (file.size > 1024 * 1024) { showError("Choose a CSV smaller than 1 MB."); return; }
    setChecking(true);
    try {
      const result = previewMarksCsv(await file.text(), roster, marks, maxScore);
      setPreview(result);
      if (result.issues.length > 0) showError(`${result.issues.length} row problems need correction before anything is saved.`);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Couldn't read this CSV.");
    } finally { setChecking(false); }
  }

  async function apply() {
    if (!preview || preview.issues.length > 0 || preview.changes.length === 0 || busy || saving) return;
    setBusy(true);
    setError(null);
    try {
      // Detect edits made by another teacher after this browser preview.
      const current = await api.schoolMarks(assessmentId);
      if (current.termStatus !== "open") { showError("The term is closed. Reload the marks before importing."); return; }
      const currentScores = new Map(current.marks.map((mark) => [mark.studentId, mark.score]));
      if (preview.changes.some((change) => (currentScores.get(change.studentId) ?? null) !== change.before)) {
        showError("Some marks changed since this preview. Download a fresh template and review again.");
        return;
      }
      const saved = await onSave(preview.changes.map((change) => ({ studentId: change.studentId, score: change.after, expectedScore: change.before })));
      if (saved) { setPreview(null); setFilename(""); }
    } catch {
      showError("Couldn't recheck the latest marks. Try again before saving.");
    } finally { setBusy(false); }
  }

  return <Card title="Import marks from CSV">
    <p className={styles.lede}>Download this assessment’s roster, fill the score column, and preview changes. Blank scores stay unrecorded. Existing scores in the template make corrections visible.</p>
    <div className={styles.actions}>
      <Button variant="secondary" onClick={() => downloadCsv("school-marks-template.csv", marksCsvTemplate(roster, marks))} disabled={busy || saving}>Download roster template</Button>
      <label className={styles.fileLabel} htmlFor={`marks-csv-${assessmentId}`}>Choose completed CSV</label>
      <input id={`marks-csv-${assessmentId}`} className={styles.fileInput} type="file" accept=".csv,text/csv" disabled={busy || saving || checking} onChange={(event) => void handleFile(event)} />
    </div>
    {filename ? <p className={styles.filename}>Selected: {filename}</p> : null}
    {checking ? <p role="status">Checking every row…</p> : null}
    {error ? <div ref={alertRef} tabIndex={-1} role="alert" className={styles.error}><strong>Check the import</strong><p>{error}</p></div> : null}
    {preview ? <div className={styles.preview}>
      <div className={styles.summary} aria-live="polite">
        <strong>{preview.changes.length} {preview.changes.length === 1 ? "score" : "scores"} to save</strong>
        <span>{preview.blankCount} blank · {preview.issues.length} problems</span>
      </div>
      {preview.issues.length > 0 ? <>
        <div className={styles.scroll}><table><thead><tr><th>CSV row</th><th>Student ID</th><th>Problem</th></tr></thead><tbody>{preview.issues.map((issue, index) => <tr key={`${issue.row}-${issue.studentId}-${index}`}><td>{issue.row || "Missing"}</td><td>{issue.studentId}</td><td>{issue.message}</td></tr>)}</tbody></table></div>
        <Button variant="secondary" onClick={() => downloadCsv("school-marks-errors.csv", marksCsvErrorReport(preview.issues))}>Download error CSV</Button>
      </> : <>
        {preview.changes.length > 0 ? <div className={styles.scroll}><table><thead><tr><th>Student</th><th>Admission no.</th><th>Current</th><th>New</th></tr></thead><tbody>{preview.changes.map((change) => <tr key={change.studentId}><td>{change.fullName}</td><td>{change.admissionNo}</td><td>{change.before ?? "Not recorded"}</td><td>{change.after}</td></tr>)}</tbody></table></div> : <p className={styles.lede}>This file has no score changes to save.</p>}
        <Button onClick={() => void apply()} loading={busy} disabled={saving || preview.changes.length === 0}>Save {preview.changes.length} {preview.changes.length === 1 ? "score" : "scores"}</Button>
      </>}
    </div> : null}
  </Card>;
}
