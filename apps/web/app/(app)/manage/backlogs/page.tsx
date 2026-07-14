"use client";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type GradeScaleView,
  type OrgTree,
  type StudentResult,
} from "@/ui/api";
import { PageHeader } from "@/ui/PageHeader";
import { DataTable, type Column } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

/**
 * The SPPU ATKT limit (backlogs a student may carry to the next year). Fixed
 * for now.
 * ponytail: hardcoded college-wide; move to a per-college setting when the
 * settings surface exists.
 */
const ATKT_LIMIT = 5;

/** A backlog is a subject that earned zero grade points (an F) — PDF 2.3. */
type BacklogRow = {
  student: StudentResult;
  subjects: { subjectId: string; subjectName: string; grade: string }[];
};

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

  const classes = useMemo(
    () => (tree !== null && tree !== "error" ? tree.departments.flatMap((d) => d.classes) : []),
    [tree],
  );

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

  if (tree === "error") return <EmptyState title="Couldn't load the college." message="Try again shortly." />;
  if (tree === null) return <Skeleton lines={5} />;

  const columns: Column<BacklogRow>[] = [
    {
      key: "admissionNo",
      header: "Admission no.",
      render: (row) => <span className="num">{row.student.admissionNo}</span>,
    },
    {
      key: "name",
      header: "Student",
      render: (row) => (
        <a className="risk-name" href={`/students/${encodeURIComponent(row.student.studentId)}`}>
          {row.student.studentName}
        </a>
      ),
    },
    {
      key: "count",
      header: "Backlogs",
      render: (row) => (
        <span className={`chip${row.subjects.length >= ATKT_LIMIT ? " serious" : ""}`}>
          {row.subjects.length}
          {row.subjects.length >= ATKT_LIMIT ? ` · over ATKT limit (${ATKT_LIMIT})` : ""}
        </span>
      ),
    },
    {
      key: "subjects",
      header: "Backlog subjects",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {row.subjects.map((s) => (
            <span key={s.subjectId} className="chip" title={`grade ${s.grade}`}>
              {s.subjectName}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "sgpa",
      header: "SGPA",
      align: "right",
      render: (row) => <span className="num">{row.student.sgpa.toFixed(2)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Examinations · ATKT"
        title="Backlog status"
        lede={`Every student carrying an F (zero grade points) this year, and their count against the ATKT limit of ${ATKT_LIMIT}. Compiled live from marks — a cleared re-exam drops the student off this list automatically.`}
      />

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <label className="field" style={{ minWidth: 240, marginBottom: 0 }}>
          <span>Class</span>
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Choose a class…</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ minWidth: 200, marginBottom: 0 }}>
          <span>Grade scale</span>
          <select value={scaleId} onChange={(e) => setScaleId(e.target.value)}>
            {scales.length === 0 ? <option value="">No scales yet</option> : null}
            {scales.map((scale) => (
              <option key={scale.id} value={scale.id}>{scale.name}</option>
            ))}
          </select>
        </label>
      </div>

      {load.state === "idle" ? (
        <div className="state"><strong>Pick a class and grade scale</strong> to compile its backlog status.</div>
      ) : load.state === "loading" ? (
        <Skeleton lines={4} />
      ) : load.state === "no-credits" ? (
        <div className="state">
          <strong>No credits set for this class yet.</strong> Set subject credits on the Results desk, then the backlog status compiles.
        </div>
      ) : load.state === "error" ? (
        <EmptyState title="Couldn't compile backlogs." message="Try again shortly." />
      ) : load.rows.length === 0 ? (
        <EmptyState
          title="Clear register — no backlogs."
          message="No student in this class is carrying an F this year."
        />
      ) : (
        <DataTable columns={columns} rows={load.rows} rowKey={(row) => row.student.studentId} />
      )}
    </>
  );
}
