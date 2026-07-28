"use client";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { api, ApiError, currentAcademicYear, type CwkAssignment, type CwkMaterial, type CwkSubmission } from "@/ui/api";
import { AsyncState } from "@/ui/AsyncState";
import {
  useToast,
  Button,
  Input,
  Select,
  Table,
  StatusBadge,
  Modal,
  EmptyState,
  Skeleton,
  PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Target = { classId: string; subjectId: string; label: string };
type AssignmentRow = { title: ReactNode; due: ReactNode; max: ReactNode; subs: ReactNode; actions: ReactNode };
type MaterialRow = { title: ReactNode; type: ReactNode; size: ReactNode; dl: ReactNode };

export default function CourseworkPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetIdx, setTargetIdx] = useState(0);
  const [assignments, setAssignments] = useState<CwkAssignment[] | null>(null);
  const [materials, setMaterials] = useState<CwkMaterial[] | null>(null);
  const [listsError, setListsError] = useState(false);
  const [saving, setSaving] = useState(false);
  // create-assignment modal
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueOn, setDueOn] = useState(today);
  const [maxScore, setMaxScore] = useState("");
  // evaluate drawer
  const [evalFor, setEvalFor] = useState<CwkAssignment | null>(null);
  const [subs, setSubs] = useState<CwkSubmission[] | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  // material upload
  const [uploading, setUploading] = useState(false);
  const [matTitle, setMatTitle] = useState("");
  const [matFile, setMatFile] = useState<{ contentType: string; dataBase64: string } | null>(null);
  const [doomed, setDoomed] = useState<CwkAssignment | null>(null);

  useEffect(() => {
    api.dashboard(year).then((dash) => {
      const found: Target[] = [];
      for (const tile of dash.tiles) {
        if (tile.type === "teacher-class") {
          found.push({
            classId: tile.classId,
            subjectId: tile.subjectId,
            label: `${dash.names[tile.classId] ?? tile.classId} · ${dash.names[tile.subjectId] ?? tile.subjectId}`,
          });
        }
      }
      setTargets(found);
    }).catch(() => setTargets([]));
  }, [year]);

  const target = targets?.[targetIdx];
  const load = useCallback(async () => {
    if (!target) return;
    setAssignments(null);
    setMaterials(null);
    setListsError(false);
    try {
      const [a, m] = await Promise.all([
        api.cwkClassAssignments(target.classId, year),
        api.cwkClassMaterials(target.classId, year),
      ]);
      setAssignments(a.assignments.filter((row) => row.subjectId === target.subjectId));
      setMaterials(m.materials.filter((row) => row.subjectId === target.subjectId));
    } catch {
      setAssignments([]);
      setMaterials([]);
      setListsError(true);
    }
  }, [target, year]);
  useEffect(() => {
    void load();
  }, [load]);

  async function createAssignment() {
    if (!target || title.trim() === "") return;
    setSaving(true);
    try {
      await api.cwkCreateAssignment({
        classId: target.classId,
        subjectId: target.subjectId,
        title,
        instructions,
        dueOn,
        ...(maxScore !== "" ? { maxScore: Number(maxScore) } : {}),
        academicYear: year,
      });
      toast.push({ status: "good", message: `Assignment "${title}" created.` });
      setCreating(false);
      setTitle("");
      setInstructions("");
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't create." });
    } finally {
      setSaving(false);
    }
  }

  async function openEvaluate(assignment: CwkAssignment) {
    setEvalFor(assignment);
    setSubs(null);
    setScores({});
    try {
      setSubs((await api.cwkSubmissions(assignment.id)).submissions);
    } catch {
      setSubs([]);
    }
  }

  async function evaluateOne(submission: CwkSubmission) {
    const raw = scores[submission.id];
    if (raw === undefined || raw === "") return;
    try {
      await api.cwkEvaluate(submission.id, { score: Number(raw), feedback: "" });
      toast.push({ status: "good", message: `${submission.studentName} scored.` });
      if (evalFor) await openEvaluate(evalFor);
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't score." });
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
      setMatFile({ contentType: file.type || "application/octet-stream", dataBase64: base64 });
      if (matTitle === "") setMatTitle(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function uploadMaterial() {
    if (!target || matTitle.trim() === "" || matFile === null) return;
    setSaving(true);
    try {
      await api.cwkUploadMaterial({
        classId: target.classId,
        subjectId: target.subjectId,
        title: matTitle,
        contentType: matFile.contentType,
        dataBase64: matFile.dataBase64,
        academicYear: year,
      });
      toast.push({ status: "good", message: `"${matTitle}" uploaded.` });
      setUploading(false);
      setMatTitle("");
      setMatFile(null);
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't upload." });
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment() {
    if (!doomed) return;
    try {
      await api.cwkDeleteAssignment(doomed.id);
      toast.push({ status: "good", message: "Assignment deleted." });
      setDoomed(null);
      await load();
    } catch (caught) {
      setDoomed(null);
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't delete." });
    }
  }

  if (targets === null) {
    return (
      <div className={styles.skeletonStack} aria-hidden="true">
        <Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} />
      </div>
    );
  }
  if (targets.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Coursework" title="Assignments & study material" />
        <EmptyState title="No subject you teach." body="Coursework is managed by a subject's teacher." />
      </>
    );
  }

  const assignmentColumns: TableColumn<AssignmentRow>[] = [
    { key: "title", header: "Assignment" },
    { key: "due", header: "Due", figure: true },
    { key: "max", header: "Max", figure: true, align: "right" },
    { key: "subs", header: "Submissions", figure: true, align: "right" },
    { key: "actions", header: "", align: "right" },
  ];
  const assignmentRows: AssignmentRow[] = (assignments ?? []).map((row) => ({
    title: <strong>{row.title}</strong>,
    due: <span className="num">{row.dueOn}</span>,
    max: <span className="num">{row.maxScore ?? "—"}</span>,
    subs: <span className="num">{row.submissions ?? 0}</span>,
    actions: (
      <span className={styles.rowActions}>
        <Button variant="ghost" onClick={() => void openEvaluate(row)}>Evaluate</Button>
        <Button variant="danger" onClick={() => setDoomed(row)}>Delete</Button>
      </span>
    ),
  }));
  const materialColumns: TableColumn<MaterialRow>[] = [
    { key: "title", header: "Material" },
    { key: "type", header: "Type" },
    { key: "size", header: "Size", figure: true, align: "right" },
    { key: "dl", header: "", align: "right" },
  ];
  const materialRows: MaterialRow[] = (materials ?? []).map((row) => ({
    title: <strong>{row.title}</strong>,
    type: <StatusBadge status="neutral">{row.contentType.split("/")[1] ?? row.contentType}</StatusBadge>,
    size: <span className="num">{(row.sizeBytes / 1024).toFixed(1)} KB</span>,
    dl: <a className="btn ghost" href={api.cwkMaterialUrl(row.id)} download>Download</a>,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Coursework"
        title="Assignments & study material"
        actions={
          <span className={styles.headerActions}>
            <Button variant="ghost" onClick={() => setUploading(true)}>Upload material</Button>
            <Button onClick={() => setCreating(true)}>New assignment</Button>
          </span>
        }
      />
      <p className={styles.lede}>Create assignments, evaluate submissions, and share notes — scoped to the subject you teach.</p>

      <div className={styles.targetPicker}>
        <Select
          id="cwk-target"
          label="Class · subject"
          value={targetIdx}
          onChange={(event) => setTargetIdx(Number(event.target.value))}
          options={targets.map((t, index) => ({ value: String(index), label: t.label }))}
        />
      </div>

      <section className="section" aria-label="Assignments">
        <div className="section-head"><h2>Assignments</h2></div>
        <AsyncState
          loading={assignments === null && !listsError}
          error={listsError}
          onRetry={() => void load()}
          isEmpty={assignments !== null && assignments.length === 0}
          empty={<EmptyState title="No assignments yet." body="Create one with the button above." />}
        >
          <Table columns={assignmentColumns} rows={assignmentRows} />
        </AsyncState>
      </section>

      <section className="section" aria-label="Study material">
        <div className="section-head"><h2>Study material</h2></div>
        <AsyncState
          loading={materials === null && !listsError}
          error={listsError}
          onRetry={() => void load()}
          isEmpty={materials !== null && materials.length === 0}
          empty={<EmptyState title="No material yet." body="Upload notes for your students." />}
        >
          <Table columns={materialColumns} rows={materialRows} />
        </AsyncState>
      </section>

      {/* CREATE ASSIGNMENT */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={`New assignment — ${target?.label ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={() => void createAssignment()} loading={saving} disabled={title.trim() === ""}>Create</Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <Input id="cwk-title" label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <div className={styles.field}>
            <label htmlFor="cwk-instr" className={styles.fieldLabel}>Instructions</label>
            <textarea id="cwk-instr" rows={4} className={styles.textarea} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          </div>
          <div className={styles.formRow}>
            <Input id="cwk-due" label="Due on" type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
            <Input id="cwk-max" label="Max score (optional)" type="number" className={styles.narrow} value={maxScore} onChange={(event) => setMaxScore(event.target.value)} />
          </div>
        </div>
      </Modal>

      {/* EVALUATE */}
      <Modal
        open={evalFor !== null}
        onClose={() => setEvalFor(null)}
        title={`Submissions — ${evalFor?.title ?? ""}`}
        footer={<Button onClick={() => setEvalFor(null)}>Done</Button>}
      >
        {subs === null ? (
          <div className={styles.skeletonStack} aria-hidden="true">
            <Skeleton height={14} /><Skeleton height={14} /><Skeleton height={14} />
          </div>
        ) : subs.length === 0 ? (
          <p className="strip-empty">No submissions yet.</p>
        ) : (
          <div className={styles.subList}>
            {subs.map((submission) => (
              <div key={submission.id} className={styles.subRow}>
                <div className={styles.subHead}>
                  <strong>{submission.studentName}</strong>
                  <span className={`num ${styles.subMeta}`}>{new Date(submission.submittedAt).toLocaleString()}</span>
                </div>
                {submission.body !== "" ? <p className={styles.subBody}>{submission.body}</p> : null}
                <div className={styles.subScore}>
                  {submission.score !== null ? (
                    <StatusBadge status="good">
                      scored {submission.score}{evalFor?.maxScore != null ? `/${evalFor.maxScore}` : ""}
                    </StatusBadge>
                  ) : (
                    <>
                      <input
                        type="number"
                        placeholder="score"
                        aria-label={`score for ${submission.studentName}`}
                        value={scores[submission.id] ?? ""}
                        className={styles.scoreInput}
                        onChange={(event) => setScores((current) => ({ ...current, [submission.id]: event.target.value }))}
                      />
                      <Button variant="ghost" onClick={() => void evaluateOne(submission)}>Save score</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* UPLOAD MATERIAL */}
      <Modal
        open={uploading}
        onClose={() => setUploading(false)}
        title={`Upload material — ${target?.label ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setUploading(false)}>Cancel</Button>
            <Button onClick={() => void uploadMaterial()} loading={saving} disabled={matTitle.trim() === "" || matFile === null}>Upload</Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <Input id="mat-title" label="Title" value={matTitle} onChange={(event) => setMatTitle(event.target.value)} />
          <Input id="mat-file" label="File (≤1MB)" type="file" onChange={onFile} />
        </div>
      </Modal>

      <Modal
        open={doomed !== null}
        onClose={() => setDoomed(null)}
        title="Delete assignment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDoomed(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void removeAssignment()}>Delete</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>
          Delete &quot;{doomed?.title ?? ""}&quot;? Blocked once submissions exist.
        </p>
      </Modal>
    </>
  );
}
