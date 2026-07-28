"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type OrgTree,
  type ReportParams,
  type ReportView,
  type StudentView,
} from "@/ui/api";
import { AsyncState } from "@/ui/AsyncState";
import {
  useToast, Button, Select, Table, StatusBadge, EmptyState, PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const TONE: Record<ReportView["status"], "good" | "warn" | "danger" | "neutral"> = {
  completed: "good",
  pending: "warn",
  running: "warn",
  failed: "danger",
};

type Need = "student" | "section" | "class";
const KINDS: { kind: ReportParams["kind"]; label: string; need: Need; formats: ("pdf" | "csv")[] }[] = [
  { kind: "grade-card", label: "Grade card — one student", need: "student", formats: ["pdf"] },
  { kind: "hall-ticket", label: "Exam hall ticket — one student", need: "student", formats: ["pdf"] },
  { kind: "student-performance", label: "Student performance", need: "student", formats: ["pdf", "csv"] },
  { kind: "section-attendance", label: "Section attendance register", need: "section", formats: ["pdf", "csv"] },
  { kind: "marks-summary", label: "Class marks summary", need: "class", formats: ["pdf", "csv"] },
  { kind: "at-risk", label: "At-risk students — a class", need: "class", formats: ["pdf", "csv"] },
];

type ReportRow = {
  kind: ReactNode; format: ReactNode; year: ReactNode; status: ReactNode; rows: ReactNode;
  created: ReactNode; actions: ReactNode;
};

export default function ReportsPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const toast = useToast();
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [kindIdx, setKindIdx] = useState(0);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [roster, setRoster] = useState<StudentView[]>([]);
  const [format, setFormat] = useState<"pdf" | "csv">("pdf");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setReports((await api.listReports(50)).reports);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    api.colleges()
      .then(async ({ colleges }) => {
        if (colleges[0]) setTree(await api.collegeTree(colleges[0].id));
      })
      .catch(() => undefined);
  }, [load]);

  const classes = useMemo(() => (tree ? tree.departments.flatMap((d) => d.classes) : []), [tree]);
  const sections = useMemo(
    () =>
      tree
        ? tree.departments.flatMap((d) => d.classes.flatMap((c) => c.sections.map((s) => ({ ...s, className: c.name }))))
        : [],
    [tree],
  );
  const spec = KINDS[kindIdx]!;

  useEffect(() => {
    if (spec.need !== "student" || sectionId === "") return;
    api.sectionRoster(sectionId).then((r) => setRoster(r.students)).catch(() => setRoster([]));
  }, [spec.need, sectionId]);

  useEffect(() => {
    if (!spec.formats.includes(format)) setFormat(spec.formats[0]!);
  }, [spec, format]);

  function buildParams(): ReportParams | null {
    if (spec.need === "class") {
      if (classId === "") return null;
      return spec.kind === "at-risk"
        ? { kind: "at-risk", level: "class", nodeId: classId }
        : { kind: "marks-summary", classId };
    }
    if (spec.need === "section") {
      return sectionId === "" ? null : { kind: "section-attendance", sectionId };
    }
    if (studentId === "") return null;
    return { kind: spec.kind, studentId } as ReportParams;
  }

  async function generate() {
    const params = buildParams();
    if (params === null) {
      toast.push({ status: "info", message: "Pick the target first." });
      return;
    }
    setBusy(true);
    try {
      await api.requestReport(params, format, year);
      toast.push({ status: "good", message: "Report requested — it runs in the worker; refresh in a moment." });
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't request the report." });
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumn<ReportRow>[] = [
    { key: "kind", header: "Report" },
    { key: "format", header: "Format" },
    { key: "year", header: "Year", figure: true },
    { key: "status", header: "Status" },
    { key: "rows", header: "Rows", figure: true, align: "right" },
    { key: "created", header: "Requested", figure: true },
    { key: "actions", header: "", align: "right" },
  ];
  const tableRows: ReportRow[] = (reports ?? []).map((row) => ({
    kind: row.kind,
    format: <StatusBadge status="neutral">{row.format.toUpperCase()}</StatusBadge>,
    year: <span className="num">{row.academicYear}</span>,
    status: (
      <span title={row.error ?? undefined}>
        <StatusBadge status={TONE[row.status]}>{row.status}</StatusBadge>
      </span>
    ),
    rows: <span className="num">{row.rows}</span>,
    created: <span className="num">{new Date(row.createdAt).toLocaleString()}</span>,
    actions:
      row.status === "completed" ? (
        <a className="btn ghost" href={api.downloadUrl(row.id)} download>Download</a>
      ) : null,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        actions={<Button variant="ghost" onClick={() => void load()}>Refresh</Button>}
      />
      <p className={styles.lede}>Generate a report, then download it — every download is re-checked against your scope.</p>

      <section className="section" aria-label="Generate a report">
        <div className="section-head"><h2>Generate a report</h2></div>
        <div className={styles.formRow}>
          <Select
            id="r-kind" label="Report type" className={styles.wide}
            value={String(kindIdx)}
            onChange={(e) => { setKindIdx(Number(e.target.value)); setStudentId(""); }}
            options={KINDS.map((k, i) => ({ value: String(i), label: k.label }))}
          />

          {spec.need === "class" ? (
            <Select
              id="r-class" label="Class" className={styles.mid}
              value={classId} onChange={(e) => setClassId(e.target.value)}
              options={[{ value: "", label: "Choose class…" }, ...classes.map((c) => ({ value: c.id, label: c.name }))]}
            />
          ) : null}

          {spec.need === "section" || spec.need === "student" ? (
            <Select
              id="r-sec" label="Section" className={styles.mid}
              value={sectionId} onChange={(e) => { setSectionId(e.target.value); setStudentId(""); }}
              options={[{ value: "", label: "Choose section…" }, ...sections.map((s) => ({ value: s.id, label: `${s.className} · ${s.name}` }))]}
            />
          ) : null}

          {spec.need === "student" ? (
            <Select
              id="r-stu" label="Student" className={styles.mid}
              value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={sectionId === ""}
              options={[
                { value: "", label: sectionId === "" ? "Pick a section first" : "Choose student…" },
                ...roster.map((s) => ({ value: s.id, label: `${s.fullName} (${s.admissionNo})` })),
              ]}
            />
          ) : null}

          <Select
            id="r-fmt" label="Format"
            value={format} onChange={(e) => setFormat(e.target.value as "pdf" | "csv")}
            options={spec.formats.map((f) => ({ value: f, label: f.toUpperCase() }))}
          />

          <Button onClick={() => void generate()} loading={busy}>Generate report</Button>
        </div>
        <p className={`field-hint ${styles.hint}`}>
          Reports run in the background worker. If they stay “pending”, make sure the worker is running (<span className="num">pnpm dev:worker</span>).
        </p>
      </section>

      <AsyncState
        loading={reports === null && !failed}
        error={failed}
        onRetry={() => void load()}
        isEmpty={reports !== null && reports.length === 0}
        empty={<EmptyState title="No reports yet." body="Generate one above — it appears here as it runs." />}
      >
        <Table columns={columns} rows={tableRows} />
      </AsyncState>
    </>
  );
}
