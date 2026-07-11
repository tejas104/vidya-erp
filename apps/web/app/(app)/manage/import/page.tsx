"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, currentAcademicYear, type ImportView } from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";

export const dynamic = "force-dynamic";

const HINTS: Record<"students" | "teachers", string> = {
  students:
    "Columns: admission_no, full_name — optionally department_code, class_code, section_name to enroll (needs the academic year).",
  teachers: "Columns: staff_no, full_name.",
};

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
            toast.show(
              view.status === "completed"
                ? `${view.dryRun ? "Dry-run" : "Import"} completed — ${view.okRows} ok, ${view.errorRows} error(s).`
                : "Import failed.",
              view.status === "completed" && view.errorRows === 0 ? "good" : "danger",
            );
            return;
          }
          if (Date.now() - started > 30_000) {
            setRunning(false);
            toast.show("The import is taking too long — check back on this page.", "info");
            return;
          }
          pollRef.current = setTimeout(() => void poll(), 1000);
        } catch {
          setRunning(false);
          toast.show("Lost contact while the import ran.", "danger");
        }
      };
      await poll();
    } catch (caught) {
      setRunning(false);
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't start the import.", "danger");
    }
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  if (failed) return <EmptyState title="Couldn't load the college." message="Try again shortly." />;

  const errorColumns: Column<{ row: number; message: string }>[] = [
    { key: "row", header: "Row", align: "right", render: (row) => <span className="num">{row.row}</span> },
    { key: "message", header: "Problem", render: (row) => row.message },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Import"
        title="Bulk CSV import"
        lede="Paste or upload a CSV of students or teachers. Dry-run validates every row and writes nothing."
      />

      <Card>
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <Field label="Kind" htmlFor="imp-kind" hint={HINTS[kind]}>
              <select id="imp-kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                <option value="students">students</option>
                <option value="teachers">teachers</option>
              </select>
            </Field>
            {kind === "students" ? (
              <Field label="Academic year" htmlFor="imp-year" hint="Used when enroll columns are present.">
                <input id="imp-year" value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} style={{ width: 120 }} />
              </Field>
            ) : null}
            <Field label="Mode" htmlFor="imp-dry">
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 14, paddingTop: 10 }}>
                <input id="imp-dry" type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
                Dry-run (validate only)
              </label>
            </Field>
          </div>
          <Field label="CSV content" htmlFor="imp-csv">
            <textarea
              id="imp-csv"
              rows={8}
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder={kind === "students" ? "admission_no,full_name\nFYCS-101,Asha Iyer" : "staff_no,full_name\nS-201,Ravi Menon"}
              style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
            />
          </Field>
          <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center", flexWrap: "wrap" }}>
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
            <Badge tone={result.status === "completed" ? (result.errorRows === 0 ? "good" : "warn") : "danger"}>
              {result.status}{result.dryRun ? " · dry-run" : ""}
            </Badge>
          </div>
          <div className="stats" style={{ marginBottom: "var(--space-4)" }}>
            <div className="stat"><div className="stat-value">{result.totalRows}</div><div className="stat-label">rows</div></div>
            <div className="stat"><div className="stat-value">{result.okRows} ok</div><div className="stat-label">valid{result.dryRun ? "" : " · written"}</div></div>
            <div className="stat"><div className="stat-value">{result.errorRows}</div><div className="stat-label">errors</div></div>
          </div>
          {result.errorRows > 0 ? (
            <DataTable columns={errorColumns} rows={result.errors} rowKey={(row) => String(row.row)} />
          ) : null}
        </section>
      ) : null}
    </>
  );
}
