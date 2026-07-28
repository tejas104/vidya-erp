"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type GradeBand,
  type GradeScaleView,
  type OrgTree,
  type PublicationView,
  type StudentResult,
} from "@/ui/api";
import {
  useToast,
  Button,
  Input,
  Select,
  Modal,
  Table,
  StatusBadge,
  Card,
  EmptyState,
  Skeleton,
  PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import { AVATARS, initials } from "@/ui/avatar";
import { StudentSlideOver, type DrawerStudent } from "@/ui/StudentSlideOver";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/** The client mirror of the contract's tiling rule — for inline copy before submit. */
export function bandsProblem(bands: GradeBand[]): string | null {
  if (bands.length === 0) return "Add at least one band.";
  for (const band of bands) {
    if (Number.isNaN(band.minPct) || band.minPct < 0 || band.minPct > 100) return "Minimum % must be between 0 and 100.";
    if (Number.isNaN(band.points) || band.points < 0 || band.points > 10) return "Points must be between 0 and 10.";
    if (band.grade.trim() === "") return "Every band needs a grade label.";
  }
  if (new Set(bands.map((band) => band.minPct)).size !== bands.length)
    return "Two bands share the same minimum — bands may not overlap.";
  if (!bands.some((band) => band.minPct === 0)) return "Bands must cover 0–100: one band must start at 0.";
  return null;
}

const DEFAULT_BANDS: GradeBand[] = [
  { minPct: 90, grade: "A+", points: 10 },
  { minPct: 80, grade: "A", points: 9 },
  { minPct: 70, grade: "B+", points: 8 },
  { minPct: 60, grade: "B", points: 7 },
  { minPct: 50, grade: "C", points: 6 },
  { minPct: 40, grade: "D", points: 5 },
  { minPct: 0, grade: "F", points: 0 },
];

type Row = { rank: ReactNode; student: ReactNode; grades: ReactNode; sgpa: ReactNode; actions: ReactNode };

export default function ResultsPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [tree, setTree] = useState<OrgTree | null | "error">(null);
  const [scales, setScales] = useState<GradeScaleView[]>([]);
  // scale modal
  const [editingScale, setEditingScale] = useState(false);
  const [scaleName, setScaleName] = useState("10-point");
  const [bands, setBands] = useState<GradeBand[]>(DEFAULT_BANDS);
  const [savingScale, setSavingScale] = useState(false);
  const [doomedScale, setDoomedScale] = useState<GradeScaleView | null>(null);
  // credits
  const [creditsClassId, setCreditsClassId] = useState("");
  const [creditRows, setCreditRows] = useState<{ subjectId: string; name: string; credits: number }[] | null>(null);
  const [savingCredits, setSavingCredits] = useState(false);
  // preview & publish
  const [previewClassId, setPreviewClassId] = useState("");
  const [previewScaleId, setPreviewScaleId] = useState("");
  const [preview, setPreview] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "no-credits" }
    | { state: "ok"; rows: StudentResult[]; publications: PublicationView[] }
  >({ state: "idle" });
  const [term, setTerm] = useState("Term 1");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [viewing, setViewing] = useState<StudentResult | null>(null);

  const collegeId = tree !== null && tree !== "error" ? tree.college.id : null;
  const classes = tree !== null && tree !== "error" ? tree.departments.flatMap((dep) => dep.classes) : [];
  const classOf = (classId: string) => classes.find((cls) => cls.id === classId);

  useEffect(() => {
    api.colleges()
      .then(async ({ colleges }) => {
        const college = colleges[0];
        if (!college) { setTree("error"); return; }
        const [orgTree, scaleList] = await Promise.all([
          api.collegeTree(college.id),
          api.resScales(college.id).catch(() => ({ scales: [] as GradeScaleView[] })),
        ]);
        setTree(orgTree);
        setScales(scaleList.scales);
      })
      .catch(() => setTree("error"));
  }, []);

  async function loadCredits(classId: string) {
    setCreditsClassId(classId);
    setCreditRows(null);
    if (classId === "" || tree === null || tree === "error") return;
    const department = tree.departments.find((dep) => dep.classes.some((cls) => cls.id === classId));
    const subjects = department?.subjects ?? [];
    try {
      const { credits } = await api.resCredits(classId, year);
      const byId = new Map(credits.map((row) => [row.subjectId, row.credits]));
      setCreditRows(subjects.map((subject) => ({ subjectId: subject.id, name: subject.name, credits: byId.get(subject.id) ?? 0 })));
    } catch {
      setCreditRows(subjects.map((subject) => ({ subjectId: subject.id, name: subject.name, credits: 0 })));
    }
  }

  async function saveCredits() {
    if (creditRows === null) return;
    const entries = creditRows.filter((row) => row.credits >= 1).map((row) => ({ subjectId: row.subjectId, credits: row.credits }));
    if (entries.length === 0) { toast.push({ status: "danger", message: "Set at least one subject's credits." }); return; }
    setSavingCredits(true);
    try {
      await api.resSetCredits({ classId: creditsClassId, academicYear: year, entries });
      toast.push({ status: "good", message: "Credits saved." });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't save credits." });
    } finally {
      setSavingCredits(false);
    }
  }

  async function saveScale() {
    const problem = bandsProblem(bands);
    if (problem !== null || collegeId === null) return;
    setSavingScale(true);
    try {
      const created = await api.resCreateScale({ collegeId, name: scaleName, bands });
      setScales((rows) => [...rows, created]);
      setEditingScale(false);
      toast.push({ status: "good", message: `Scale "${created.name}" created.` });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't create the scale." });
    } finally {
      setSavingScale(false);
    }
  }

  async function removeScale() {
    if (!doomedScale) return;
    try {
      await api.resDeleteScale(doomedScale.id);
      setScales((rows) => rows.filter((row) => row.id !== doomedScale.id));
      toast.push({ status: "good", message: "Scale deleted." });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't delete." });
    } finally {
      setDoomedScale(null);
    }
  }

  async function loadPreview() {
    if (previewClassId === "" || previewScaleId === "") return;
    setPreview({ state: "loading" });
    try {
      const result = await api.resClassResults(previewClassId, year, previewScaleId);
      setPreview({ state: "ok", ...result });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) setPreview({ state: "no-credits" });
      else {
        setPreview({ state: "idle" });
        toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't compile results." });
      }
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      const publication = await api.resPublish({ classId: previewClassId, academicYear: year, term, scaleId: previewScaleId });
      setPreview((state) => (state.state === "ok" ? { ...state, publications: [...state.publications, publication] } : state));
      toast.push({ status: "good", message: `${term} published — students see it now.` });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't publish." });
    } finally {
      setPublishing(false);
      setConfirmPublish(false);
    }
  }

  function toDrawerStudent(row: StudentResult, idx: number, sectionLabel: string): DrawerStudent {
    const backlogs = row.subjects.filter((subject) => subject.points === 0).length;
    return {
      studentId: row.studentId,
      initials: initials(row.studentName),
      gradient: AVATARS[idx % AVATARS.length]!,
      rollNo: row.admissionNo,
      name: row.studentName,
      section: sectionLabel,
      status: backlogs > 0 ? "backlog" : "active",
      pct: null,
      attended: 0,
      total: 0,
      lastMark: null,
      backlogs,
      flags: { backlog: backlogs > 0, yb: false },
      phone: null,
      guardianName: null,
      guardianPhone: null,
      dob: null,
    };
  }

  if (tree === null) return <Skeleton height={16} />;
  if (tree === "error") return <EmptyState title="Couldn't load the organisation." body="Try again shortly." />;

  const bandProblem = bandsProblem(bands);
  const previewColumns: TableColumn<Row>[] = [
    { key: "rank", header: "Rank", figure: true },
    { key: "student", header: "Student" },
    { key: "grades", header: "Grades" },
    { key: "sgpa", header: "SGPA", figure: true, align: "right" },
    { key: "actions", header: "" },
  ];
  const previewRows: Row[] = preview.state === "ok" ? preview.rows.map((row) => ({
    rank: row.rank,
    student: (
      <span>
        <strong>{row.studentName}</strong>{" "}
        <span className={`num ${styles.admissionNo}`}>{row.admissionNo}</span>
      </span>
    ),
    grades: (
      <span className={styles.gradeChips}>
        {row.subjects.map((subject) => (
          <StatusBadge key={subject.subjectId} status="neutral">{`${subject.subjectName.slice(0, 14)} ${subject.grade}`}</StatusBadge>
        ))}
      </span>
    ),
    sgpa: <strong className="num">{row.sgpa.toFixed(2)}</strong>,
    actions: <Button variant="ghost" onClick={() => setViewing(row)}>View</Button>,
  })) : [];

  return (
    <>
      <PageHeader eyebrow="Results" title="The marksheet desk" />
      <p className={styles.lede}>
        Define the grade scale, set subject credits, compile a class, and publish — students see nothing until you do.
      </p>

      <section className="section" aria-label="Grade scales">
        <div className="section-head">
          <h2>Grade scales</h2>
          <Button variant="ghost" onClick={() => { setScaleName("10-point"); setBands(DEFAULT_BANDS); setEditingScale(true); }}>
            New scale
          </Button>
        </div>
        {scales.length === 0 ? (
          <EmptyState title="No grade scale yet." body="Create one — the compile step needs it." />
        ) : (
          <Card>
            {scales.map((scale) => (
              <div key={scale.id} className={styles.scaleRow}>
                <span className={styles.scaleLabel}>
                  <strong>{scale.name}</strong>
                  {scale.locked ? <StatusBadge status="neutral">in use</StatusBadge> : null}
                  <span className={`num ${styles.scaleBands}`}>
                    {[...scale.bands].sort((a, b) => b.minPct - a.minPct).map((band) => `${band.minPct}→${band.grade}/${band.points}`).join(" · ")}
                  </span>
                </span>
                {scale.locked ? null : (
                  <Button variant="danger" onClick={() => setDoomedScale(scale)}>Delete</Button>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="section" aria-label="Subject credits">
        <div className="section-head"><h2>Subject credits · {year}</h2></div>
        <Card>
          <Select
            id="res-credits-class"
            label="Class"
            value={creditsClassId}
            onChange={(event) => void loadCredits(event.target.value)}
            options={[{ value: "", label: "Pick a class…" }, ...classes.map((cls) => ({ value: cls.id, label: cls.name }))]}
          />
          {creditsClassId !== "" && creditRows === null ? <Skeleton height={16} /> : null}
          {creditRows !== null && creditRows.length === 0 ? (
            <EmptyState title="No subjects in this class's department." body="Create subjects first under Organisation." />
          ) : null}
          {creditRows !== null && creditRows.length > 0 ? (
            <div className={styles.creditList}>
              {creditRows.map((row, index) => (
                <div key={row.subjectId} className={styles.creditRow}>
                  <label htmlFor={`res-credit-${row.subjectId}`}>{row.name}</label>
                  <input
                    id={`res-credit-${row.subjectId}`}
                    type="number" min={0} max={10} step={1}
                    value={row.credits}
                    onChange={(event) => {
                      const credits = Number(event.target.value);
                      setCreditRows((rows) => rows === null ? null : rows.map((r, i) => (i === index ? { ...r, credits } : r)));
                    }}
                    className={styles.creditInput}
                    aria-label={`${row.name} credits`}
                  />
                </div>
              ))}
              <div className={styles.creditSave}>
                <Button onClick={() => void saveCredits()} loading={savingCredits}>Save credits</Button>
              </div>
              <p className={styles.creditHint}>Subjects left at 0 are not counted in SGPA.</p>
            </div>
          ) : null}
        </Card>
      </section>

      <section className="section" aria-label="Compile and publish">
        <div className="section-head"><h2>Compile &amp; publish · {year}</h2></div>
        <Card>
          <div className={styles.pickerRow}>
            <Select
              id="res-preview-class"
              label="Class"
              value={previewClassId}
              onChange={(event) => { setPreviewClassId(event.target.value); setPreview({ state: "idle" }); }}
              options={[{ value: "", label: "Pick a class…" }, ...classes.map((cls) => ({ value: cls.id, label: cls.name }))]}
            />
            <Select
              id="res-preview-scale"
              label="Grade scale"
              value={previewScaleId}
              onChange={(event) => { setPreviewScaleId(event.target.value); setPreview({ state: "idle" }); }}
              options={[{ value: "", label: "Pick a scale…" }, ...scales.map((scale) => ({ value: scale.id, label: scale.name }))]}
            />
            <Button onClick={() => void loadPreview()} disabled={previewClassId === "" || previewScaleId === ""}>
              Compile
            </Button>
          </div>

          {preview.state === "no-credits" ? (
            <EmptyState title="No credits set for this class." body="Set subject credits above, then compile again." />
          ) : null}
          <AsyncState loading={preview.state === "loading"} error={false} isEmpty={preview.state === "ok" && preview.rows.length === 0} empty={<EmptyState title="No computable results." body="No marks are recorded for this class yet." />}>
            {preview.state === "ok" ? (
              <div className={styles.previewBlock}>
                {preview.publications.length > 0 ? (
                  <p className={styles.publishedRow}>
                    <span>Published:</span>
                    {preview.publications.map((publication) => (
                      <StatusBadge key={publication.id} status="good">{publication.term}</StatusBadge>
                    ))}
                  </p>
                ) : null}
                <Table columns={previewColumns} rows={previewRows} />
                {preview.rows.length > 0 ? (
                  <div className={styles.publishRow}>
                    <Input id="res-term" label="Term" value={term} onChange={(event) => setTerm(event.target.value)} className={styles.narrow} />
                    <Button
                      onClick={() => setConfirmPublish(true)}
                      disabled={term.trim() === "" || preview.publications.some((publication) => publication.term === term.trim())}
                    >
                      Publish
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </AsyncState>
        </Card>
      </section>

      <Modal
        open={editingScale}
        onClose={() => setEditingScale(false)}
        title="New grade scale"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingScale(false)}>Cancel</Button>
            <Button onClick={() => void saveScale()} loading={savingScale} disabled={bandProblem !== null || scaleName.trim() === ""}>
              Create scale
            </Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <Input id="res-scale-name" label="Name" value={scaleName} onChange={(event) => setScaleName(event.target.value)} />
          <div className={styles.bandsList}>
            {bands.map((band, index) => (
              <div key={index} className={styles.bandRow}>
                <input
                  type="number" min={0} max={100} value={band.minPct} aria-label={`Band ${index + 1} minimum %`}
                  onChange={(event) => setBands((rows) => rows.map((row, i) => (i === index ? { ...row, minPct: Number(event.target.value) } : row)))}
                  className={styles.bandPct}
                />
                <span className={styles.bandArrow}>% →</span>
                <input
                  value={band.grade} aria-label={`Band ${index + 1} grade`}
                  onChange={(event) => setBands((rows) => rows.map((row, i) => (i === index ? { ...row, grade: event.target.value } : row)))}
                  className={styles.bandGrade}
                />
                <input
                  type="number" min={0} max={10} value={band.points} aria-label={`Band ${index + 1} points`}
                  onChange={(event) => setBands((rows) => rows.map((row, i) => (i === index ? { ...row, points: Number(event.target.value) } : row)))}
                  className={styles.bandGrade}
                />
                <Button variant="ghost" onClick={() => setBands((rows) => rows.filter((_, i) => i !== index))} aria-label={`Remove band ${index + 1}`}>
                  ×
                </Button>
              </div>
            ))}
            <div>
              <Button variant="ghost" onClick={() => setBands((rows) => [...rows, { minPct: 0, grade: "", points: 0 }])}>
                Add band
              </Button>
            </div>
            {bandProblem !== null ? (
              <p className="formerror" role="alert" style={{ margin: 0 }}>{bandProblem}</p>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        title="Publish results"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmPublish(false)}>Cancel</Button>
            <Button onClick={() => void publish()} loading={publishing}>Publish</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>
          Publish {classOf(previewClassId)?.name ?? "this class"} · {term} results? Students see them immediately.
        </p>
      </Modal>

      <Modal
        open={doomedScale !== null}
        onClose={() => setDoomedScale(null)}
        title="Delete grade scale"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDoomedScale(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void removeScale()}>Delete</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>Delete &quot;{doomedScale?.name ?? ""}&quot;? Scales used by a publication can&apos;t be deleted.</p>
      </Modal>

      <StudentSlideOver
        student={viewing ? toDrawerStudent(viewing, preview.state === "ok" ? preview.rows.indexOf(viewing) : 0, classOf(previewClassId)?.name ?? "") : null}
        canManage={false}
        onClose={() => setViewing(null)}
      />
    </>
  );
}
