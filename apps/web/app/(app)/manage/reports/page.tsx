"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  ApiError,
  currentAcademicYear,
  type OrgTree,
  type ReportParams,
  type ReportView,
  type Session,
  type StudentView,
} from "@/ui/api";
import { useHelpEdition } from "@/ui/help/HelpEditionContext";
import { AsyncState } from "@/ui/AsyncState";
import {
  useToast, Button, Input, Select, Table, StatusBadge, EmptyState, PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import { HelpButton } from "@/ui/help/HelpButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const TONE: Record<ReportView["status"], "good" | "warn" | "danger" | "neutral"> = {
  completed: "good",
  pending: "warn",
  running: "warn",
  failed: "danger",
};

type Need = "student" | "section" | "class" | "school-date";
const KINDS: { kind: ReportParams["kind"]; label: string; need: Need; formats: ("pdf" | "csv" | "xlsx")[] }[] = [
  { kind: "grade-card", label: "Grade card — one student", need: "student", formats: ["pdf", "xlsx", "csv"] },
  { kind: "hall-ticket", label: "Exam hall ticket — one student", need: "student", formats: ["pdf", "xlsx", "csv"] },
  { kind: "student-performance", label: "Student performance", need: "student", formats: ["pdf", "xlsx", "csv"] },
  { kind: "section-attendance", label: "Section attendance register", need: "section", formats: ["pdf", "xlsx", "csv"] },
  { kind: "marks-summary", label: "Class marks summary", need: "class", formats: ["pdf", "xlsx", "csv"] },
  { kind: "at-risk", label: "At-risk students — a class", need: "class", formats: ["pdf", "xlsx", "csv"] },
  { kind: "teacher-attendance", label: "Teacher attendance — daily register", need: "school-date", formats: ["pdf", "xlsx", "csv"] },
];

function todayLocal(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type ReportRow = {
  kind: ReactNode; format: ReactNode; year: ReactNode; status: ReactNode; rows: ReactNode;
  created: ReactNode; actions: ReactNode;
};

export default function ReportsPage() {
  const router = useRouter();
  const edition = useHelpEdition();
  const year = useMemo(() => currentAcademicYear(), []);
  const toast = useToast();
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [reportDate, setReportDate] = useState(todayLocal);
  const [kindIdx, setKindIdx] = useState(0);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [roster, setRoster] = useState<StudentView[]>([]);
  const [format, setFormat] = useState<"pdf" | "csv" | "xlsx">("pdf");
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
    api.session().then(setSession).catch(() => undefined);
    api.colleges()
      .then(async ({ colleges }) => {
        setSchools(colleges);
        setSchoolId(colleges[0]?.id ?? "");
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
  const kinds = useMemo(() => KINDS.filter((item) => item.need !== "school-date" ||
    (edition === "school" && session?.roles.some((role) => role === "admin" || role === "principal"))), [edition, session]);
  const spec = kinds[kindIdx] ?? kinds[0]!;

  useEffect(() => {
    if (spec.need !== "student" || sectionId === "") return;
    api.sectionRoster(sectionId).then((r) => setRoster(r.students)).catch(() => setRoster([]));
  }, [spec.need, sectionId]);

  useEffect(() => {
    if (!spec.formats.includes(format)) setFormat(spec.formats[0]!);
  }, [spec, format]);

  function buildParams(): ReportParams | null {
    if (spec.need === "school-date") {
      return schoolId && reportDate ? { kind: "teacher-attendance", collegeId: schoolId, date: reportDate } : null;
    }
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
      const reportYear = params.kind === "teacher-attendance"
        ? currentAcademicYear(new Date(`${params.date}T12:00:00`)) : year;
      await api.requestReport(params, format, reportYear);
      toast.push({ status: "good", message: "Report requested. Select Refresh shortly to check when it's ready." });
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
    kind: KINDS.find((item) => item.kind === row.kind)?.label ?? row.kind,
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
        <a className="btn ghost" href={api.downloadUrl(row.id)} download>Download {row.format.toUpperCase()}</a>
      ) : null,
  }));

  return (
    <>
      <button className="section-back" type="button" onClick={() => {
        if (window.history.length > 1 && window.history.state?.__NA) router.back();
        else router.push("/dashboard");
      }} aria-label="Back to previous section">
        <span aria-hidden="true">←</span> Back to previous section
      </button>
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        lede="Generate a report, then download it — every download is re-checked against your scope."
        actions={<Button variant="ghost" onClick={() => void load()}>Refresh</Button>}
        help={<HelpButton slug="reports" />}
      />

      <section className="section" aria-label="Generate a report">
        <div className="section-head"><h2>Generate a report</h2></div>
        <div className={styles.formRow}>
          <Select
            id="r-kind" label="Report type" className={styles.wide}
            value={String(kindIdx)}
            onChange={(e) => { setKindIdx(Number(e.target.value)); setStudentId(""); }}
            options={kinds.map((k, i) => ({ value: String(i), label: k.label }))}
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

          {spec.need === "school-date" ? <>
            <Select
              id="r-school" label="School" className={styles.mid}
              value={schoolId} onChange={(event) => setSchoolId(event.target.value)}
              options={[{ value: "", label: "Choose school…" }, ...schools.map((school) => ({ value: school.id, label: school.name }))]}
            />
            <Input id="r-date" label="Attendance date" type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
          </> : null}

          <Select
            id="r-fmt" label="Format"
            value={format} onChange={(e) => setFormat(e.target.value as "pdf" | "csv" | "xlsx")}
            options={spec.formats.map((f) => ({ value: f, label: f === "xlsx" ? "Excel (.xlsx)" : f.toUpperCase() }))}
          />

          <Button onClick={() => void generate()} loading={busy}>Generate report</Button>
        </div>
        <p className={`field-hint ${styles.hint}`}>
          Reports usually finish shortly. Select Refresh to check when your download is ready.
        </p>
      </section>

      <AsyncState
        loading={reports === null && !failed}
        error={failed}
        errorMessage="Couldn't load your reports. Try again shortly."
        onRetry={() => void load()}
        isEmpty={reports !== null && reports.length === 0}
        empty={<EmptyState title="No reports yet." body="Generate one above — it appears here as it runs." />}
      >
        <Table columns={columns} rows={tableRows} />
      </AsyncState>
    </>
  );
}
