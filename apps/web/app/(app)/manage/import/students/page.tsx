"use client";
import { useMemo, useState, type ChangeEvent } from "react";
import { api, currentAcademicYear } from "@/ui/api";
import { useToast, Button, Card, EmptyState, Input, PageHeader, Skeleton } from "@vidya/ui-system";
import { DeniedState } from "@/ui/DeniedState";
import { HelpButton } from "@/ui/help/HelpButton";
import { useImportRun } from "@/ui/useImportRun";
import { ImportResult } from "@/ui/ImportResult";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/**
 * Dedicated Import Students screen (assignment #11, task A4). Splits off the
 * old one-size-fits-all /manage/import form: this one is locked to
 * kind:"students" and carries the academic-year field enrollment needs.
 * The dry-run/poll/confirm dance itself lives in useImportRun — shared with
 * the staff screen, not re-implemented here.
 */
export default function ImportStudentsPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [academicYear, setAcademicYear] = useState(year);
  const { load, csv, setCsv, onFile, phase, progress, run, reset } = useImportRun("students");

  async function dryRun() {
    const result = await run(true, { academicYear });
    if (result?.name === "preview") {
      toast.push({
        status: result.view.errorRows === 0 ? "good" : "info",
        message: `Dry-run completed — ${result.view.okRows} ok, ${result.view.warningRows} warning, ${result.view.errorRows} error(s).`,
      });
    } else if (result?.name === "failed") {
      toast.push({ status: "danger", message: result.message });
    }
  }

  async function confirm() {
    const result = await run(false, { academicYear });
    if (result?.name === "done") {
      toast.push({
        status: result.view.errorRows === 0 ? "good" : "info",
        message: `Import completed — ${result.view.okRows} written, ${result.view.errorRows} error(s).`,
      });
    } else if (result?.name === "failed") {
      toast.push({ status: "danger", message: result.message });
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFile(file);
  }

  const header = (
    <PageHeader
      eyebrow="Import"
      title="Import students"
      lede="Download the template, upload a CSV, and validate with a dry-run before anything is written."
      help={<HelpButton slug="import-students" />}
    />
  );

  if (load.name === "loading") {
    return (
      <>
        {header}
        <div className={styles.skeletonStack} aria-hidden="true">
          <Skeleton height={16} />
          <Skeleton height={16} />
          <Skeleton height={120} />
        </div>
      </>
    );
  }
  if (load.name === "empty") {
    return (
      <>
        {header}
        <EmptyState title="No college to import into yet." body="Set up your organisation before importing students." />
      </>
    );
  }
  if (load.name === "error") {
    return (
      <>
        {header}
        <div className="state" role="alert">
          <strong>Couldn't load.</strong> {load.message}
        </div>
      </>
    );
  }
  if (load.name === "denied") {
    return (
      <>
        {header}
        <DeniedState title="Outside your scope." message="Importing students is an admin-only action." />
      </>
    );
  }

  const locked = phase.name === "running" || phase.name === "preview" || phase.name === "done";
  const previewDisabled = locked || csv.trim() === "";
  const previewLoading = phase.name === "running" && phase.dryRun;
  const confirmDisabled =
    phase.name === "idle" || phase.name === "failed" || phase.name === "done" || (phase.name === "running" && phase.dryRun);
  const confirmLoading = phase.name === "running" && !phase.dryRun;

  return (
    <>
      {header}

      <Card title="Template">
        <p className={styles.formHint}>
          Columns: admission_no, full_name — optionally department_code, class_code, section_name to enroll (needs the
          academic year below).
        </p>
        <a className="btn ghost" href={api.importTemplateUrl("students")} download>
          Download CSV template
        </a>
      </Card>

      <Card title="Upload & run">
        <div className={styles.formGrid}>
          <div className={styles.formRow}>
            <Input
              id="imp-students-year"
              label="Academic year"
              hint="Used when enroll columns are present."
              value={academicYear}
              onChange={(event) => setAcademicYear(event.target.value)}
              className={styles.narrow}
              disabled={locked}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="imp-students-csv" className={styles.label}>CSV content</label>
            <textarea
              id="imp-students-csv"
              rows={8}
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder={"admission_no,full_name\nFYCS-101,Asha Iyer"}
              className={styles.textarea}
              disabled={locked}
            />
          </div>
          <div className={styles.formRow}>
            <input type="file" accept=".csv,text/csv" onChange={onFileChange} aria-label="Upload CSV file" disabled={locked} />
            <Button onClick={() => void dryRun()} loading={previewLoading} disabled={previewDisabled}>
              Preview (dry-run)
            </Button>
            <Button onClick={() => void confirm()} loading={confirmLoading} disabled={confirmDisabled}>
              Confirm & import
            </Button>
            {phase.name !== "idle" ? (
              <Button variant="ghost" onClick={reset} disabled={phase.name === "running"}>
                Start over
              </Button>
            ) : null}
          </div>
          {phase.name === "running" ? (
            <p className={styles.formHint} role="status">
              {progress ? `${progress.processed} / ${progress.total} rows processed…` : "Starting…"}
            </p>
          ) : null}
        </div>
      </Card>

      {phase.name === "failed" ? (
        <div className="state" role="alert">
          <strong>{phase.dryRun ? "Dry-run failed." : "Import failed."}</strong> {phase.message}
        </div>
      ) : null}

      {phase.name === "preview" || phase.name === "done" ? (
        <section className="section" aria-label={phase.name === "preview" ? "Preview" : "Import result"}>
          <div className="section-head">
            <h2>{phase.name === "preview" ? "Preview" : "Result"}</h2>
          </div>
          <ImportResult view={phase.view} final={phase.name === "done"} />
        </section>
      ) : null}
    </>
  );
}
