"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type GradeScaleView,
  type OrgTree,
  type StudentResult,
} from "@/ui/api";
import { AsyncState } from "@/ui/AsyncState";
import { StudentSlideOver, type DrawerStudent } from "@/ui/StudentSlideOver";
import { Button, EmptyState, PageHeader, Select, Skeleton, StatusBadge, Table, type TableColumn } from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/**
 * The SPPU ATKT limit (backlogs a student may carry to the next year). Fixed
 * for now.
 * ponytail: hardcoded college-wide; move to a per-college setting when the
 * settings surface exists.
 */
const ATKT_LIMIT = 5;

const AVATARS = [
  "linear-gradient(140deg,#6B7BFF,#4A5BD8)",
  "linear-gradient(140deg,#F59E0B,#D97706)",
  "linear-gradient(140deg,#10B981,#059669)",
  "linear-gradient(140deg,#8B5CF6,#7C3AED)",
  "linear-gradient(140deg,#EC4899,#DB2777)",
  "linear-gradient(140deg,#06B6D4,#0891B2)",
];
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "·";
}

/** A backlog is a subject that earned zero grade points (an F) — PDF 2.3. */
type BacklogRow = {
  student: StudentResult;
  subjects: { subjectId: string; subjectName: string; grade: string }[];
};

type Row = { admissionNo: ReactNode; name: ReactNode; count: ReactNode; subjects: ReactNode; sgpa: ReactNode; actions: ReactNode };

export default function BacklogsPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [tree, setTree] = useState<OrgTree | null | "error">(null);
  const [scales, setScales] = useState<GradeScaleView[]>([]);
  const [classId, setClassId] = useState("");
  const [scaleId, setScaleId] = useState("");
  const [load, setLoad] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "no-credits" }
    | { state: "error" }
    | { state: "ok"; rows: BacklogRow[] }
  >({ state: "idle" });
  const [viewing, setViewing] = useState<BacklogRow | null>(null);

  const classes = useMemo(
    () => (tree !== null && tree !== "error" ? tree.departments.flatMap((d) => d.classes) : []),
    [tree],
  );
  const classLabel = classes.find((cls) => cls.id === classId)?.name ?? "";

  useEffect(() => {
    api
      .colleges()
      .then(async ({ colleges }) => {
        const college = colleges[0];
        if (!college) {
          setTree("error");
          return;
        }
        const [orgTree, scaleList] = await Promise.all([
          api.collegeTree(college.id),
          api.resScales(college.id).catch(() => ({ scales: [] as GradeScaleView[] })),
        ]);
        setTree(orgTree);
        setScales(scaleList.scales);
        if (scaleList.scales[0]) setScaleId(scaleList.scales[0].id);
      })
      .catch(() => setTree("error"));
  }, []);

  useEffect(() => {
    if (classId === "" || scaleId === "") {
      setLoad({ state: "idle" });
      return;
    }
    let alive = true;
    setLoad({ state: "loading" });
    api
      .resClassResults(classId, year, scaleId)
      .then((res) => {
        if (!alive) return;
        const rows: BacklogRow[] = res.rows
          .map((student) => ({
            student,
            subjects: student.subjects
              .filter((s) => s.points === 0)
              .map((s) => ({ subjectId: s.subjectId, subjectName: s.subjectName, grade: s.grade })),
          }))
          .filter((r) => r.subjects.length > 0)
          .sort((a, b) => b.subjects.length - a.subjects.length);
        setLoad({ state: "ok", rows });
      })
      .catch((caught) => {
        if (!alive) return;
        setLoad({ state: caught instanceof ApiError && caught.status === 422 ? "no-credits" : "error" });
      });
    return () => {
      alive = false;
    };
  }, [classId, scaleId, year]);

  function toDrawerStudent(row: BacklogRow, idx: number): DrawerStudent {
    return {
      studentId: row.student.studentId,
      initials: initials(row.student.studentName),
      gradient: AVATARS[idx % AVATARS.length]!,
      rollNo: row.student.admissionNo,
      name: row.student.studentName,
      section: classLabel,
      status: "backlog",
      pct: null,
      attended: 0,
      total: 0,
      lastMark: null,
      backlogs: row.subjects.length,
      flags: { backlog: true, yb: false },
      phone: null,
      guardianName: null,
      guardianPhone: null,
      dob: null,
    };
  }

  if (tree === "error") return <EmptyState title="Couldn't load the college." body="Try again shortly." />;
  if (tree === null) return <Skeleton height={16} />;

  const columns: TableColumn<Row>[] = [
    { key: "admissionNo", header: "Admission no.", figure: true },
    { key: "name", header: "Student" },
    { key: "count", header: "Backlogs" },
    { key: "subjects", header: "Backlog subjects" },
    { key: "sgpa", header: "SGPA", figure: true },
    { key: "actions", header: "" },
  ];
  const rows: Row[] = load.state === "ok" ? load.rows.map((row) => ({
    admissionNo: row.student.admissionNo,
    name: (
      <a className="risk-name" href={`/students/${encodeURIComponent(row.student.studentId)}`}>
        {row.student.studentName}
      </a>
    ),
    count: (
      <span className={`chip${row.subjects.length >= ATKT_LIMIT ? " serious" : ""}`}>
        {row.subjects.length}
        {row.subjects.length >= ATKT_LIMIT ? ` · over ATKT limit (${ATKT_LIMIT})` : ""}
      </span>
    ),
    subjects: (
      <span className={styles.subjectChips}>
        {row.subjects.map((s) => (
          <StatusBadge key={s.subjectId} status="neutral">{s.subjectName}</StatusBadge>
        ))}
      </span>
    ),
    sgpa: row.student.sgpa.toFixed(2),
    actions: <Button variant="ghost" onClick={() => setViewing(row)}>View</Button>,
  })) : [];

  return (
    <>
      <PageHeader title="Backlog status" />
      <p className={styles.lede}>
        Every student carrying an F (zero grade points) this year, and their count against the ATKT limit of {ATKT_LIMIT}. Compiled live from marks — a cleared re-exam drops the student off this list automatically.
      </p>

      <div className={styles.pickerRow}>
        <Select
          id="bkl-class"
          label="Class"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          options={[{ value: "", label: "Choose a class…" }, ...classes.map((cls) => ({ value: cls.id, label: cls.name }))]}
        />
        <Select
          id="bkl-scale"
          label="Grade scale"
          value={scaleId}
          onChange={(e) => setScaleId(e.target.value)}
          options={scales.length === 0 ? [{ value: "", label: "No scales yet" }] : scales.map((scale) => ({ value: scale.id, label: scale.name }))}
        />
      </div>

      {load.state === "idle" ? (
        <div className="state"><strong>Pick a class and grade scale</strong> to compile its backlog status.</div>
      ) : load.state === "no-credits" ? (
        <div className="state">
          <strong>No credits set for this class yet.</strong> Set subject credits on the Results desk, then the backlog status compiles.
        </div>
      ) : (
        <AsyncState
          loading={load.state === "loading"}
          error={load.state === "error"}
          isEmpty={load.state === "ok" && load.rows.length === 0}
          empty={<EmptyState title="Clear register — no backlogs." body="No student in this class is carrying an F this year." />}
        >
          <Table columns={columns} rows={rows} />
        </AsyncState>
      )}

      <StudentSlideOver
        student={viewing ? toDrawerStudent(viewing, load.state === "ok" ? load.rows.indexOf(viewing) : 0) : null}
        canManage={false}
        onClose={() => setViewing(null)}
      />
    </>
  );
}
