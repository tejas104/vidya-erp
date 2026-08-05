"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ImportView } from "./api";

/**
 * Shared import flow for the students/staff screens (task A4). Both screens
 * run the exact same dance — download template, upload CSV, dry-run,
 * preview, confirm, poll again — so the poller lives here ONCE instead of
 * being copy-pasted per screen. This is a straight extraction of the poll
 * loop that used to live inline in the old /manage/import page.
 */

const POLL_MS = 1000;
const TIMEOUT_MS = 30_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type ImportLoadState =
  | { name: "loading" }
  | { name: "empty" }
  | { name: "error"; message: string }
  | { name: "denied" }
  | { name: "ready"; collegeId: string };

export type ImportPhase =
  | { name: "idle" }
  | { name: "running"; dryRun: boolean }
  | { name: "preview"; view: ImportView }
  | { name: "done"; view: ImportView }
  | { name: "failed"; dryRun: boolean; message: string };

/** Poll one import until it leaves pending/running, reporting each tick so
 * the caller can show real processed/total progress instead of a spinner.
 * `isAlive` is checked before every network call AND before every state
 * update it triggers via `onTick` — once the caller unmounts, the loop
 * stops issuing `getImport` calls (not just stops touching state) and
 * returns `null`. */
async function pollImport(
  importId: string,
  onTick: (view: ImportView) => void,
  isAlive: () => boolean,
): Promise<ImportView | null> {
  const started = Date.now();
  for (;;) {
    if (!isAlive()) return null;
    const view = await api.getImport(importId);
    if (!isAlive()) return null;
    onTick(view);
    if (view.status === "completed" || view.status === "failed") return view;
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error("The import is taking too long — check back on this page.");
    }
    await sleep(POLL_MS);
  }
}

export function useImportRun(kind: "students" | "teachers") {
  const [load, setLoad] = useState<ImportLoadState>({ name: "loading" });
  const [csv, setCsv] = useState("");
  const [phase, setPhase] = useState<ImportPhase>({ name: "idle" });
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    api
      .colleges()
      .then(({ colleges }) => {
        if (!alive.current) return;
        const first = colleges[0];
        setLoad(first ? { name: "ready", collegeId: first.id } : { name: "empty" });
      })
      .catch((caught) => {
        if (!alive.current) return;
        setLoad(
          caught instanceof ApiError && caught.status === 403
            ? { name: "denied" }
            : { name: "error", message: "Couldn't load your college." },
        );
      });
    return () => {
      alive.current = false;
    };
  }, []);

  /** Runs one pass (dry or confirm) and returns the resulting phase — the
   * caller can toast off the return value instead of chasing state updates
   * through an effect. Reuses the same `alive` ref the college-load effect
   * sets false on unmount, so navigating away mid-poll stops the poll loop
   * (no further `getImport` calls) and skips every state update below it —
   * the old page's `clearTimeout(pollRef.current)` cleanup, carried over. */
  async function run(dryRun: boolean, extra: { academicYear?: string } = {}): Promise<ImportPhase | null> {
    if (load.name !== "ready" || csv.trim() === "") return null;
    setProgress(null);
    setPhase({ name: "running", dryRun });
    try {
      const { importId } = await api.createImport({ kind, collegeId: load.collegeId, dryRun, csv, ...extra });
      const view = await pollImport(
        importId,
        (tick) => {
          if (alive.current) setProgress({ processed: tick.processedRows, total: tick.totalRows });
        },
        () => alive.current,
      );
      if (view === null || !alive.current) return null; // unmounted mid-poll — stop, don't touch state
      const next: ImportPhase =
        view.status === "failed"
          ? { name: "failed", dryRun, message: "The import failed." }
          : dryRun
            ? { name: "preview", view }
            : { name: "done", view };
      setPhase(next);
      return next;
    } catch (caught) {
      if (!alive.current) return null;
      if (caught instanceof ApiError && caught.status === 403) {
        setLoad({ name: "denied" });
        return null;
      }
      const next: ImportPhase = {
        name: "failed",
        dryRun,
        message: caught instanceof ApiError || caught instanceof Error ? caught.message : "Couldn't run the import.",
      };
      setPhase(next);
      return next;
    }
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function reset() {
    setCsv("");
    setProgress(null);
    setPhase({ name: "idle" });
  }

  return { load, csv, setCsv, onFile, phase, progress, run, reset };
}
