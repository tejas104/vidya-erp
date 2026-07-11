"use client";

import { useRef, useState } from "react";
import { api, ApiError, type ReportParams } from "./api";

type Phase =
  | { name: "idle" }
  | { name: "working" }
  | { name: "ready"; reportId: string }
  | { name: "error"; message: string };

/**
 * Requests a report, polls until it's generated, then offers the scoped
 * download link. The download is re-scope-checked server-side, so this
 * control never exposes anything the caller couldn't already read.
 */
export function ReportButton({
  params,
  year,
  format = "pdf",
  label,
}: {
  params: ReportParams;
  year: string;
  format?: "pdf" | "csv";
  label: string;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function generate() {
    setPhase({ name: "working" });
    try {
      const reportId = await api.requestReport(params, format, year);
      const started = Date.now();
      const poll = async () => {
        try {
          const status = await api.reportStatus(reportId);
          if (status.status === "completed") {
            setPhase({ name: "ready", reportId });
            return;
          }
          if (status.status === "failed") {
            setPhase({ name: "error", message: "The report couldn't be generated." });
            return;
          }
          if (Date.now() - started > 30_000) {
            setPhase({ name: "error", message: "The report is taking too long. Try again." });
            return;
          }
          timer.current = setTimeout(poll, 700);
        } catch {
          setPhase({ name: "error", message: "Lost contact while generating the report." });
        }
      };
      await poll();
    } catch (caught) {
      const forbidden = caught instanceof ApiError && caught.status === 403;
      setPhase({
        name: "error",
        message: forbidden ? "This report is outside your scope." : "Couldn't start the report.",
      });
    }
  }

  if (phase.name === "ready") {
    return (
      <a className="btn ghost" href={api.downloadUrl(phase.reportId)} download data-testid="report-download">
        Download {format.toUpperCase()}
      </a>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
      <button
        className="btn ghost"
        onClick={generate}
        disabled={phase.name === "working"}
        type="button"
        data-testid="report-generate"
      >
        {phase.name === "working" ? "Preparing…" : label}
      </button>
      {phase.name === "error" ? (
        <span className="formerror" role="alert" style={{ margin: 0 }}>
          {phase.message}
        </span>
      ) : null}
    </span>
  );
}
