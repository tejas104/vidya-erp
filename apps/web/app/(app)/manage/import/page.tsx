"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, currentAcademicYear, type ImportView } from "@/ui/api";
import {
  useToast,
  Button,
  Input,
  Select,
  Table,
  StatusBadge,
  Card,
  EmptyState,
  PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const HINTS: Record<"students" | "teachers", string> = {
  students:
    "Columns: admission_no, full_name — optionally department_code, class_code, section_name to enroll (needs the academic year).",
  teachers: "Columns: staff_no, full_name.",
};

type ErrorRow = { row: number; message: string };

export default function ImportPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<"students" | "teachers">("students");
  const [academicYear, setAcademicYear] = useState(year);
  const [dryRun, setDryRun] = useState(true);
  const [csv, setCsv] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImportView | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.colleges()
      .then(({ colleges }) => setCollegeId(colleges[0]?.id ?? null))
      .catch(() => setFailed(true));
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  async function run() {
    if (!collegeId || csv.trim() === "") return;
    setRunning(true);
    setResult(null);
    try {
      const { importId } = await api.createImport({
        kind,
        collegeId,
        ...(kind === "students" ? { academicYear } : {}),
        dryRun,
        csv,
      });
      const started = Date.now();
      const poll = async () => {
        try {
          const view = await api.getImport(importId);
          if (view.status === "completed" || view.status === "failed") {
            setResult(view);
            setRunning(false);
            toast.push({
              status: view.status === "completed" && view.errorRows === 0 ? "good" : "danger",
              message:
                view.status === "completed"
                  ? `${view.dryRun ? "Dry-run" : "Import"} completed — ${view.okRows} ok, ${view.errorRows} error(s).`
                  : "Import failed.",
            });
            return;
          }
          if (Date.now() - started > 30_000) {
            setRunning(false);
            toast.push({ status: "info", message: "The import is taking too long — check back on this page." });
            return;
          }
          pollRef.current = setTimeout(() => void poll(), 1000);
        } catch {
          setRunning(false);
          toast.push({ status: "danger", message: "Lost contact while the import ran." });
        }
      };
      await poll();
    } catch (caught) {
      setRunning(false);
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't start the import." });
    }
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  if (failed) return <EmptyState title="Couldn't load the college." body="Try again shortly." />;

  const errorColumns: TableColumn<{ row: React.ReactNode; message: React.ReactNode }>[] = [
    { key: "row", header: "Row", figure: true },
    { key: "message", header: "Problem" },
  ];
  const errorRows = (result?.errors ?? []).map((row: ErrorRow) => ({
    row: <span className="num">{row.row}</span>,
    message: row.message,
  }));

  return (
    <>
      <PageHeader eyebrow="Import" title="Bulk CSV import" />
      <p className={styles.lede}>Paste or upload a CSV of students or teachers. Dry-run validates every row and writes nothing.</p>

      <Card>
        <div className={styles.formGrid}>
          <div className={styles.formRow}>
            <Select
              id="imp-kind"
              label="Kind"
              hint={HINTS[kind]}
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
              options={[
                { value: "students", label: "students" },
                { value: "teachers", label: "teachers" },
              ]}
            />
            {kind === "students" ? (
              <Input
                id="imp-year"
                label="Academic year"
                hint="Used when enroll columns are present."
                value={academicYear}
                onChange={(event) => setAcademicYear(event.target.value)}
                className={styles.narrow}
              />
            ) : null}
            <div className={styles.field}>
              <label htmlFor="imp-dry" className={styles.label}>Mode</label>
              <label className={styles.checkboxLabel}>
                <input id="imp-dry" type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
                Dry-run (validate only)
              </label>
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor="imp-csv" className={styles.label}>CSV content</label>
            <textarea
              id="imp-csv"
              rows={8}
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder={kind === "students" ? "admission_no,full_name\nFYCS-101,Asha Iyer" : "staff_no,full_name\nS-201,Ravi Menon"}
              className={styles.textarea}
            />
          </div>
          <div className={styles.formRow}>
            <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="Upload CSV file" />
            <Button onClick={() => void run()} loading={running} disabled={csv.trim() === "" || collegeId === null}>
              Run import
            </Button>
          </div>
        </div>
      </Card>

      {result !== null ? (
        <section className="section" aria-label="Import result">
          <div className="section-head">
            <h2>Result</h2>
            <StatusBadge status={result.status === "completed" ? (result.errorRows === 0 ? "good" : "warn") : "danger"}>
              {result.status}{result.dryRun ? " · dry-run" : ""}
            </StatusBadge>
          </div>
          <div className={`stats ${styles.stats}`}>
            <div className="stat"><div className="stat-value">{result.totalRows}</div><div className="stat-label">rows</div></div>
            <div className="stat"><div className="stat-value">{result.okRows} ok</div><div className="stat-label">valid{result.dryRun ? "" : " · written"}</div></div>
            <div className="stat"><div className="stat-value">{result.errorRows}</div><div className="stat-label">errors</div></div>
          </div>
          {result.errorRows > 0 ? <Table columns={errorColumns} rows={errorRows} /> : null}
        </section>
      ) : null}
    </>
  );
}
