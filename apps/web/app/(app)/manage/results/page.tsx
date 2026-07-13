"use client";
import { useEffect, useMemo, useState } from "react";
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
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { Card } from "@/ui/Card";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

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
    if (entries.length === 0) { toast.show("Set at least one subject's credits.", "danger"); return; }
    setSavingCredits(true);
    try {
      await api.resSetCredits({ classId: creditsClassId, academicYear: year, entries });
      toast.show("Credits saved.", "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't save credits.", "danger");
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
      toast.show(`Scale "${created.name}" created.`, "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't create the scale.", "danger");
    } finally {
      setSavingScale(false);
    }
  }

  async function removeScale() {
    if (!doomedScale) return;
    try {
      await api.resDeleteScale(doomedScale.id);
      setScales((rows) => rows.filter((row) => row.id !== doomedScale.id));
      toast.show("Scale deleted.", "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't delete.", "danger");
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
        toast.show(caught instanceof ApiError ? caught.message : "Couldn't compile results.", "danger");
      }
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      const publication = await api.resPublish({ classId: previewClassId, academicYear: year, term, scaleId: previewScaleId });
      setPreview((state) => (state.state === "ok" ? { ...state, publications: [...state.publications, publication] } : state));
      toast.show(`${term} published — students see it now.`, "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't publish.", "danger");
    } finally {
      setPublishing(false);
      setConfirmPublish(false);
    }
  }

  if (tree === null) return <Skeleton lines={5} />;
  if (tree === "error") return <EmptyState title="Couldn't load the organisation." message="Try again shortly." />;

  const bandProblem = bandsProblem(bands);
  const previewColumns: Column<StudentResult>[] = [
    { key: "rank", header: "Rank", render: (row) => <span className="num">{row.rank}</span> },
    {
      key: "student", header: "Student",
      render: (row) => (
        <span>
          <strong>{row.studentName}</strong>{" "}
          <span className="num" style={{ opacity: 0.6, fontSize: 12.5 }}>{row.admissionNo}</span>
        </span>
      ),
    },
    {
      key: "grades", header: "Grades",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {row.subjects.map((subject) => (
            <Badge key={subject.subjectId}>{`${subject.subjectName.slice(0, 14)} ${subject.grade}`}</Badge>
          ))}
        </span>
      ),
    },
    { key: "sgpa", header: "SGPA", align: "right", render: (row) => <strong className="num">{row.sgpa.toFixed(2)}</strong> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Results"
        title="The marksheet desk"
        lede="Define the grade scale, set subject credits, compile a class, and publish — students see nothing until you do."
      />

      <section className="section" aria-label="Grade scales">
        <div className="section-head">
          <h2>Grade scales</h2>
          <Button variant="ghost" onClick={() => { setScaleName("10-point"); setBands(DEFAULT_BANDS); setEditingScale(true); }}>
            New scale
          </Button>
        </div>
        {scales.length === 0 ? (
          <EmptyState title="No grade scale yet." message="Create one — the compile step needs it." />
        ) : (
          <Card>
            {scales.map((scale) => (
              <div key={scale.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 0", borderTop: "1px solid var(--rule)" }}>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{scale.name}</strong>
                  {scale.locked ? <Badge>in use</Badge> : null}
                  <span className="num" style={{ fontSize: 12.5, opacity: 0.7 }}>
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
          <Field label="Class" htmlFor="res-credits-class">
            <select id="res-credits-class" value={creditsClassId} onChange={(event) => void loadCredits(event.target.value)}>
              <option value="">Pick a class…</option>
              {classes.map((cls) => (<option key={cls.id} value={cls.id}>{cls.name}</option>))}
            </select>
          </Field>
          {creditsClassId !== "" && creditRows === null ? <Skeleton lines={3} /> : null}
          {creditRows !== null && creditRows.length === 0 ? (
            <EmptyState title="No subjects in this class's department." message="Create subjects first under Organisation." />
          ) : null}
          {creditRows !== null && creditRows.length > 0 ? (
            <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
              {creditRows.map((row, index) => (
                <div key={row.subjectId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, borderTop: "1px solid var(--rule)", padding: "6px 0" }}>
                  <label htmlFor={`res-credit-${row.subjectId}`}>{row.name}</label>
                  <input
                    id={`res-credit-${row.subjectId}`}
                    type="number" min={0} max={10} step={1}
                    value={row.credits}
                    onChange={(event) => {
                      const credits = Number(event.target.value);
                      setCreditRows((rows) => rows === null ? null : rows.map((r, i) => (i === index ? { ...r, credits } : r)));
                    }}
                    style={{ width: 90 }}
                    aria-label={`${row.name} credits`}
                  />
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
                <Button onClick={() => void saveCredits()} loading={savingCredits}>Save credits</Button>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, opacity: 0.65 }}>Subjects left at 0 are not counted in SGPA.</p>
            </div>
          ) : null}
        </Card>
      </section>

      <section className="section" aria-label="Compile and publish">
        <div className="section-head"><h2>Compile &amp; publish · {year}</h2></div>
        <Card>
          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Class" htmlFor="res-preview-class">
              <select id="res-preview-class" value={previewClassId} onChange={(event) => { setPreviewClassId(event.target.value); setPreview({ state: "idle" }); }}>
                <option value="">Pick a class…</option>
                {classes.map((cls) => (<option key={cls.id} value={cls.id}>{cls.name}</option>))}
              </select>
            </Field>
            <Field label="Grade scale" htmlFor="res-preview-scale">
              <select id="res-preview-scale" value={previewScaleId} onChange={(event) => { setPreviewScaleId(event.target.value); setPreview({ state: "idle" }); }}>
                <option value="">Pick a scale…</option>
                {scales.map((scale) => (<option key={scale.id} value={scale.id}>{scale.name}</option>))}
              </select>
            </Field>
            <Button onClick={() => void loadPreview()} disabled={previewClassId === "" || previewScaleId === ""}>
              Compile
            </Button>
          </div>

          {preview.state === "loading" ? <Skeleton lines={4} /> : null}
          {preview.state === "no-credits" ? (
            <EmptyState title="No credits set for this class." message="Set subject credits above, then compile again." />
          ) : null}
          {preview.state === "ok" ? (
            <div style={{ marginTop: "var(--space-4)" }}>
              {preview.publications.length > 0 ? (
                <p style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 0 }}>
                  <span style={{ fontSize: 13 }}>Published:</span>
                  {preview.publications.map((publication) => (
                    <Badge key={publication.id} tone="good">{publication.term}</Badge>
                  ))}
                </p>
              ) : null}
              <DataTable
                columns={previewColumns}
                rows={preview.rows}
                rowKey={(row) => row.studentId}
                empty={{ title: "No computable results.", message: "No marks are recorded for this class yet." }}
              />
              {preview.rows.length > 0 ? (
                <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", justifyContent: "flex-end", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
                  <Field label="Term" htmlFor="res-term">
                    <input id="res-term" value={term} onChange={(event) => setTerm(event.target.value)} style={{ width: 120 }} />
                  </Field>
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
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Name" htmlFor="res-scale-name">
            <input id="res-scale-name" value={scaleName} onChange={(event) => setScaleName(event.target.value)} />
          </Field>
          <div style={{ display: "grid", gap: 6 }}>
            {bands.map((band, index) => (
              <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number" min={0} max={100} value={band.minPct} aria-label={`Band ${index + 1} minimum %`}
                  onChange={(event) => setBands((rows) => rows.map((row, i) => (i === index ? { ...row, minPct: Number(event.target.value) } : row)))}
                  style={{ width: 84 }}
                />
                <span style={{ fontSize: 13, opacity: 0.6 }}>% →</span>
                <input
                  value={band.grade} aria-label={`Band ${index + 1} grade`}
                  onChange={(event) => setBands((rows) => rows.map((row, i) => (i === index ? { ...row, grade: event.target.value } : row)))}
                  style={{ width: 70 }}
                />
                <input
                  type="number" min={0} max={10} value={band.points} aria-label={`Band ${index + 1} points`}
                  onChange={(event) => setBands((rows) => rows.map((row, i) => (i === index ? { ...row, points: Number(event.target.value) } : row)))}
                  style={{ width: 70 }}
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

      <ConfirmDialog
        open={confirmPublish}
        title="Publish results"
        message={`Publish ${classOf(previewClassId)?.name ?? "this class"} · ${term} results? Students see them immediately.`}
        confirmLabel="Publish"
        onConfirm={() => void publish()}
        onCancel={() => setConfirmPublish(false)}
      />

      <ConfirmDialog
        open={doomedScale !== null}
        title="Delete grade scale"
        message={`Delete "${doomedScale?.name ?? ""}"? Scales used by a publication can't be deleted.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => void removeScale()}
        onCancel={() => setDoomedScale(null)}
      />
    </>
  );
}
