"use client";
import { useEffect, useMemo, useState } from "react";
import { api, currentAcademicYear, type AssessmentKind, type AssessmentView } from "@/ui/api";
import { useMutation } from "@/ui/useMutation";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";

export const dynamic = "force-dynamic";
const KINDS: AssessmentKind[] = ["quiz", "exam", "assignment"];
type Target = { classId: string; subjectId: string; label: string; sectionId?: string };
type Student = { id: string; fullName: string; admissionNo: string };

export default function MarksPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetIdx, setTargetIdx] = useState(0);
  const [assessments, setAssessments] = useState<AssessmentView[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssessmentKind>("quiz");
  const [maxScore, setMaxScore] = useState("10");
  const [active, setActive] = useState<AssessmentView | null>(null);
  const [roster, setRoster] = useState<Student[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const create = useMutation(api.createAssessment);
  const toast = useToast();
  const enter = useMutation((assessmentId: string, entries: { studentId: string; score: number }[]) => api.enterMarks(assessmentId, entries));

  useEffect(() => {
    api.dashboard(year).then((dash) => {
      const t: Target[] = [];
      for (const tile of dash.tiles) {
        if (tile.type === "teacher-class") {
          t.push({ classId: tile.classId, subjectId: tile.subjectId, sectionId: tile.strip[0]?.sectionId, label: `${dash.names[tile.classId] ?? tile.classId} · ${dash.names[tile.subjectId] ?? tile.subjectId}` });
        }
      }
      setTargets(t);
    }).catch(() => setTargets([]));
  }, [year]);

  const target = targets[targetIdx];
  useEffect(() => {
    if (!target) return;
    api.classAssessments(target.classId, year).then((r) => setAssessments(r.assessments.filter((a) => a.subjectId === target.subjectId))).catch(() => setAssessments([]));
    if (target.sectionId) api.sectionRoster(target.sectionId).then((r) => setRoster(r.students)).catch(() => setRoster([]));
  }, [targetIdx, target, year, create.phase.name]);

  async function onCreate() {
    if (!target) return;
    const created = await create.run({ classId: target.classId, subjectId: target.subjectId, kind, name, academicYear: year, maxScore: Number(maxScore) });
    if (created) {
      setActive(created);
      setName("");
      setScores({});
      toast.show(`Assessment "${created.name}" created.`, "good");
    }
  }
  async function onEnter() {
    if (!active) return;
    const entries = roster.filter((s) => scores[s.id] !== undefined && scores[s.id] !== "").map((s) => ({ studentId: s.id, score: Number(scores[s.id]) }));
    if (entries.length > 0) {
      const result = await enter.run(active.id, entries);
      if (result) toast.show("Marks saved.", "good");
    }
  }

  if (targets.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Marks" title="Enter marks" lede="Create an assessment for your subject, then enter each student's score." />
        <div className="state"><strong>No subject you teach.</strong> Marks are entered by a subject teacher.</div>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Marks" title="Enter marks" lede="Create an assessment for your subject, then enter each student's score." />

      <label className="field" style={{ maxWidth: 360 }}>
        <span>Class · subject</span>
        <select value={targetIdx} onChange={(e) => { setTargetIdx(Number(e.target.value)); setActive(null); }}>
          {targets.map((t, i) => (<option key={`${t.classId}-${t.subjectId}`} value={i}>{t.label}</option>))}
        </select>
      </label>

      <section className="section" aria-label="New assessment">
        <div className="section-head"><h2>New assessment</h2></div>
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label className="field"><span>Assessment name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><span>Kind</span><select value={kind} onChange={(e) => setKind(e.target.value as AssessmentKind)}>{KINDS.map((k) => (<option key={k} value={k}>{k}</option>))}</select></label>
            <label className="field"><span>Max score</span><input type="number" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} /></label>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="btn" type="button" disabled={create.phase.name === "saving" || name.trim() === ""} onClick={onCreate}>
              {create.phase.name === "saving" ? "Creating…" : "Create assessment"}
            </button>
            {create.phase.name === "error" ? <span className="formerror" role="alert" style={{ margin: 0 }}>{create.phase.message}</span> : null}
          </div>
        </div>
      </section>

      {active ? (
        <section className="section" aria-label="Enter scores">
          <div className="section-head"><h2>{active.name} · out of {active.maxScore}</h2></div>
          <div className="card">
            {roster.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                <span><strong>{s.fullName}</strong> <span className="num" style={{ opacity: 0.6 }}>{s.admissionNo}</span></span>
                <input type="number" min={0} max={active.maxScore} value={scores[s.id] ?? ""} style={{ width: 90 }}
                  onChange={(e) => setScores((sc) => ({ ...sc, [s.id]: e.target.value }))} aria-label={`score for ${s.fullName}`} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
            <button className="btn" type="button" disabled={enter.phase.name === "saving"} onClick={onEnter}>
              {enter.phase.name === "saving" ? "Saving…" : "Save marks"}
            </button>
            {enter.phase.name === "error" ? <span className="formerror" role="alert" style={{ margin: 0 }}>{enter.phase.message}</span> : null}
          </div>
        </section>
      ) : (
        <section className="section" aria-label="Existing assessments">
          <div className="section-head"><h2>Existing assessments</h2><span className="stat-sub num">{assessments.length}</span></div>
          <div className="card">
            {assessments.length === 0 ? <div className="strip-empty">None yet — create one above.</div> : assessments.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                <span><strong>{a.name}</strong> <span className="num" style={{ opacity: 0.6 }}>{a.kind} · /{a.maxScore}</span></span>
                <button className="btn ghost" type="button" onClick={() => setActive(a)}>Enter scores</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
