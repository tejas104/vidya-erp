"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, currentAcademicYear, type CwkAssignment, type CwkMaterial, type CwkSubmission } from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

type Target = { classId: string; subjectId: string; label: string };

export default function CourseworkPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetIdx, setTargetIdx] = useState(0);
  const [assignments, setAssignments] = useState<CwkAssignment[]>([]);
  const [materials, setMaterials] = useState<CwkMaterial[]>([]);
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
      toast.show(`Assignment "${title}" created.`, "good");
      setCreating(false);
      setTitle("");
      setInstructions("");
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't create.", "danger");
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
      toast.show(`${submission.studentName} scored.`, "good");
      if (evalFor) await openEvaluate(evalFor);
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't score.", "danger");
    }
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
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
      toast.show(`"${matTitle}" uploaded.`, "good");
      setUploading(false);
      setMatTitle("");
      setMatFile(null);
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't upload.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment() {
    if (!doomed) return;
    try {
      await api.cwkDeleteAssignment(doomed.id);
      toast.show("Assignment deleted.", "good");
      setDoomed(null);
      await load();
    } catch (caught) {
      setDoomed(null);
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't delete.", "danger");
    }
  }

  if (targets === null) return <Skeleton lines={5} />;
  if (targets.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Coursework" title="Assignments & study material" />
        <EmptyState title="No subject you teach." message="Coursework is managed by a subject's teacher." />
      </>
    );
  }

  const assignmentColumns: Column<CwkAssignment>[] = [
    { key: "title", header: "Assignment", render: (row) => <strong>{row.title}</strong> },
    { key: "due", header: "Due", render: (row) => <span className="num">{row.dueOn}</span> },
    { key: "max", header: "Max", align: "right", render: (row) => <span className="num">{row.maxScore ?? "—"}</span> },
    { key: "subs", header: "Submissions", align: "right", render: (row) => <span className="num">{row.submissions ?? 0}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => void openEvaluate(row)}>Evaluate</Button>
          <Button variant="danger" onClick={() => setDoomed(row)}>Delete</Button>
        </span>
      ),
    },
  ];
  const materialColumns: Column<CwkMaterial>[] = [
    { key: "title", header: "Material", render: (row) => <strong>{row.title}</strong> },
    { key: "type", header: "Type", render: (row) => <Badge>{row.contentType.split("/")[1] ?? row.contentType}</Badge> },
    { key: "size", header: "Size", align: "right", render: (row) => <span className="num">{(row.sizeBytes / 1024).toFixed(1)} KB</span> },
    {
      key: "dl",
      header: "",
      align: "right",
      render: (row) => (
        <a className="btn ghost" href={api.cwkMaterialUrl(row.id)} download>Download</a>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Coursework"
        title="Assignments & study material"
        lede="Create assignments, evaluate submissions, and share notes — scoped to the subject you teach."
        actions={
          <span style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={() => setUploading(true)}>Upload material</Button>
            <Button onClick={() => setCreating(true)}>New assignment</Button>
          </span>
        }
      />

      <Field label="Class · subject" htmlFor="cwk-target">
        <select id="cwk-target" value={targetIdx} onChange={(event) => setTargetIdx(Number(event.target.value))} style={{ maxWidth: 360 }}>
          {targets.map((t, index) => (
            <option key={`${t.classId}-${t.subjectId}`} value={index}>{t.label}</option>
          ))}
        </select>
      </Field>

      <section className="section" aria-label="Assignments">
        <div className="section-head"><h2>Assignments</h2></div>
        <DataTable columns={assignmentColumns} rows={assignments} rowKey={(row) => row.id} empty={{ title: "No assignments yet.", message: "Create one with the button above." }} />
      </section>

      <section className="section" aria-label="Study material">
        <div className="section-head"><h2>Study material</h2></div>
        <DataTable columns={materialColumns} rows={materials} rowKey={(row) => row.id} empty={{ title: "No material yet.", message: "Upload notes for your students." }} />
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
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Title" htmlFor="cwk-title">
            <input id="cwk-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Instructions" htmlFor="cwk-instr">
            <textarea id="cwk-instr" rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          </Field>
          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <Field label="Due on" htmlFor="cwk-due">
              <input id="cwk-due" type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
            </Field>
            <Field label="Max score (optional)" htmlFor="cwk-max">
              <input id="cwk-max" type="number" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} style={{ width: 110 }} />
            </Field>
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
          <Skeleton lines={3} />
        ) : subs.length === 0 ? (
          <p className="strip-empty">No submissions yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {subs.map((submission) => (
              <div key={submission.id} style={{ borderTop: "1px solid var(--rule)", padding: "8px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>{submission.studentName}</strong>
                  <span className="num" style={{ opacity: 0.6, fontSize: 12 }}>
                    {new Date(submission.submittedAt).toLocaleString()}
                  </span>
                </div>
                {submission.body !== "" ? (
                  <p style={{ margin: "6px 0", fontSize: 13.5, whiteSpace: "pre-wrap" }}>{submission.body}</p>
                ) : null}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {submission.score !== null ? (
                    <Badge tone="good">scored {submission.score}{evalFor?.maxScore != null ? `/${evalFor.maxScore}` : ""}</Badge>
                  ) : (
                    <>
                      <input
                        type="number"
                        placeholder="score"
                        aria-label={`score for ${submission.studentName}`}
                        value={scores[submission.id] ?? ""}
                        onChange={(event) => setScores((current) => ({ ...current, [submission.id]: event.target.value }))}
                        style={{ width: 90 }}
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
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Title" htmlFor="mat-title">
            <input id="mat-title" value={matTitle} onChange={(event) => setMatTitle(event.target.value)} />
          </Field>
          <Field label="File (≤1MB)" htmlFor="mat-file">
            <input id="mat-file" type="file" onChange={onFile} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={doomed !== null}
        title="Delete assignment"
        message={`Delete "${doomed?.title ?? ""}"? Blocked once submissions exist.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => void removeAssignment()}
        onCancel={() => setDoomed(null)}
      />
    </>
  );
}
