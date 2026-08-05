"use client";
import { type ChangeEvent } from "react";
import { api } from "@/ui/api";
import { useToast, Button, Card, EmptyState, PageHeader, Skeleton } from "@vidya/ui-system";
import { DeniedState } from "@/ui/DeniedState";
import { HelpButton } from "@/ui/help/HelpButton";
import { useImportRun } from "@/ui/useImportRun";
import { ImportResult } from "@/ui/ImportResult";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/**
 * Dedicated Import Staff screen (assignment #11, task A4) — the teacher
 * sibling of Import Students. The API's `kind` is "teachers" (there is no
 * separate "staff" kind); the route is named /staff because that's what
 * admins call this in the nav, but the request body still says "teachers".
 * Same dry-run/poll/confirm flow, same shared hook — no second poller here.
 */
export default function ImportStaffPage() {
  const toast = useToast();
  const { load, csv, setCsv, onFile, phase, progress, run, reset } = useImportRun("teachers");

  async function dryRun() {
    const result = await run(true);
    if (result?.name === "preview") {
      toast.push({
        status: result.view.errorRows === 0 ? "good" : "info",
        message: `Dry-run completed — ${result.view.okRows} ok, ${result.view.errorRows} error(s).`,
      });
    } else if (result?.name === "failed") {
      toast.push({ status: "danger", message: result.message });
    }
  }

  async function confirm() {
    const result = await run(false);
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
      title="Import staff"
      lede="Download the template, upload a CSV, and validate with a dry-run before anything is written."
      help={<HelpButton slug="import-staff" />}
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
        <EmptyState title="No college to import into yet." body="Set up your organisation before importing staff." />
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
        <DeniedState title="Outside your scope." message="Importing staff is an admin-only action." />
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
        <p className={styles.formHint}>Columns: staff_no, full_name.</p>
        <a className="btn ghost" href={api.importTemplateUrl("teachers")} download>
          Download CSV template
        </a>
      </Card>

      <Card title="Upload & run">
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label htmlFor="imp-staff-csv" className={styles.label}>CSV content</label>
            <textarea
              id="imp-staff-csv"
              rows={8}
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder={"staff_no,full_name\nS-201,Ravi Menon"}
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
