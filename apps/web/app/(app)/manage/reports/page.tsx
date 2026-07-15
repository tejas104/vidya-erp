"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type OrgTree,
  type ReportParams,
  type ReportView,
  type StudentView,
} from "@/ui/api";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";
import { useToast } from "@/ui/Toast";

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
      toast.show("Pick the target first.", "info");
      return;
    }
    setBusy(true);
    try {
      await api.requestReport(params, format, year);
      toast.show("Report requested — it runs in the worker; refresh in a moment.", "good");
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't request the report.", "danger");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ReportView>[] = [
    { key: "kind", header: "Report", render: (row) => row.kind },
    { key: "format", header: "Format", render: (row) => <Badge>{row.format.toUpperCase()}</Badge> },
    { key: "year", header: "Year", render: (row) => <span className="num">{row.academicYear}</span> },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span title={row.error ?? undefined}>
          <Badge tone={TONE[row.status]}>{row.status}</Badge>
        </span>
      ),
    },
    { key: "rows", header: "Rows", align: "right", render: (row) => <span className="num">{row.rows}</span> },
    { key: "created", header: "Requested", render: (row) => <span className="num">{new Date(row.createdAt).toLocaleString()}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.status === "completed" ? (
          <a className="btn ghost" href={api.downloadUrl(row.id)} download>Download</a>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        lede="Generate a report, then download it — every download is re-checked against your scope."
        actions={<Button variant="ghost" onClick={() => void load()}>Refresh</Button>}
      />

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 14 }}>Generate a report</h2>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Report type" htmlFor="r-kind">
            <select
              id="r-kind"
              value={kindIdx}
              onChange={(e) => { setKindIdx(Number(e.target.value)); setStudentId(""); }}
              style={{ minWidth: 240 }}
            >
              {KINDS.map((k, i) => <option key={k.kind + i} value={i}>{k.label}</option>)}
            </select>
          </Field>

          {spec.need === "class" ? (
            <Field label="Class" htmlFor="r-class">
              <select id="r-class" value={classId} onChange={(e) => setClassId(e.target.value)} style={{ minWidth: 180 }}>
                <option value="">Choose class…</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          ) : null}

          {spec.need === "section" || spec.need === "student" ? (
            <Field label="Section" htmlFor="r-sec">
              <select
                id="r-sec"
                value={sectionId}
                onChange={(e) => { setSectionId(e.target.value); setStudentId(""); }}
                style={{ minWidth: 200 }}
              >
                <option value="">Choose section…</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.className} · {s.name}</option>)}
              </select>
            </Field>
          ) : null}

          {spec.need === "student" ? (
            <Field label="Student" htmlFor="r-stu">
              <select id="r-stu" value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={sectionId === ""} style={{ minWidth: 200 }}>
                <option value="">{sectionId === "" ? "Pick a section first" : "Choose student…"}</option>
                {roster.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNo})</option>)}
              </select>
            </Field>
          ) : null}

          <Field label="Format" htmlFor="r-fmt">
            <select id="r-fmt" value={format} onChange={(e) => setFormat(e.target.value as "pdf" | "csv")}>
              {spec.formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </Field>

          <Button onClick={() => void generate()} loading={busy}>Generate report</Button>
        </div>
        <p className="field-hint" style={{ marginTop: 10 }}>
          Reports run in the background worker. If they stay “pending”, make sure the worker is running (<span className="num">pnpm dev:worker</span>).
        </p>
      </div>

      {failed ? (
        <EmptyState title="Couldn't load your reports." message="Try again shortly." />
      ) : reports === null ? (
        <Skeleton lines={4} />
      ) : (
        <DataTable
          columns={columns}
          rows={reports}
          rowKey={(row) => row.id}
          empty={{ title: "No reports yet.", message: "Generate one above — it appears here as it runs." }}
        />
      )}
    </>
  );
}
