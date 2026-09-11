"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, currentAcademicYear, type AssessmentKind, type AssessmentView } from "@/ui/api";
import { useMutation } from "@/ui/useMutation";
import { DeniedState } from "@/ui/DeniedState";
import {
  useToast,
  Button,
  Input,
  Select,
  Table,
  Card,
  EmptyState,
  PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import { HelpButton } from "@/ui/help/HelpButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
const KINDS: AssessmentKind[] = ["quiz", "exam", "assignment"];
type Target = { classId: string; subjectId: string; label: string; sectionId?: string };
type Student = { id: string; fullName: string; admissionNo: string };
type Row = { name: ReactNode; kind: ReactNode; max: ReactNode; actions: ReactNode };

/** Empty is "not yet entered" (no error, excluded from progress + save).
 * Non-empty must be a finite number within [0, max] — surfaced inline per row. */
function validateScore(raw: string, max: number): string | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a number.";
  if (n < 0 || n > max) return `0–${max} only.`;
  return null;
}

export default function MarksPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const toast = useToast();
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetIdx, setTargetIdx] = useState(0);
  const [assessments, setAssessments] = useState<AssessmentView[] | null>(null);
  const [assessmentsError, setAssessmentsError] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssessmentKind>("quiz");
  const [maxScore, setMaxScore] = useState("10");
  const [active, setActive] = useState<AssessmentView | null>(null);
  const [roster, setRoster] = useState<Student[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const create = useMutation(api.createAssessment);
  const enter = useMutation((assessmentId: string, entries: { studentId: string; score: number }[]) => api.enterMarks(assessmentId, entries));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    api.dashboard(year).then((dash) => {
      const t: Target[] = [];
      for (const tile of dash.tiles) {
        if (tile.type === "teacher-class") {
          t.push({
            classId: tile.classId,
            subjectId: tile.subjectId,
            sectionId: tile.strip[0]?.sectionId,
            label: `${dash.names[tile.classId] ?? tile.classId} · ${dash.names[tile.subjectId] ?? tile.subjectId}`,
          });
        }
      }
      setTargets(t);
    }).catch(() => setTargets([]));
  }, [year]);

  const target = targets[targetIdx];
  const loadAssessments = useCallback(async () => {
    if (!target) return;
    setAssessments(null);
    setAssessmentsError(false);
    try {
      const r = await api.classAssessments(target.classId, year);
      setAssessments(r.assessments.filter((a) => a.subjectId === target.subjectId));
    } catch {
      setAssessments(null);
      setAssessmentsError(true);
    }
    if (target.sectionId) api.sectionRoster(target.sectionId).then((r) => setRoster(r.students)).catch(() => setRoster([]));
  }, [targetIdx, target, year]);
  useEffect(() => {
    void loadAssessments();
  }, [loadAssessments, create.phase.name]);

  const rowErrors = useMemo(() => {
    const out: Record<string, string | null> = {};
    if (active) for (const s of roster) out[s.id] = validateScore(scores[s.id] ?? "", active.maxScore);
    return out;
  }, [roster, scores, active]);
  const hasErrors = Object.values(rowErrors).some((e) => e !== null);
  const enteredCount = roster.filter((s) => (scores[s.id] ?? "").trim() !== "" && rowErrors[s.id] === null).length;

  function onRowKeyDown(event: KeyboardEvent<HTMLInputElement>, i: number) {
    // Enter/Next (mobile numeric keypads show "next"/"done" via enterKeyHint)
    // and the desktop arrow keys both advance — auto-advance is "on entry",
    // not a separate tap on a Next control. Out-of-range indices are a no-op:
    // ref lookup returns undefined, optional chaining skips the focus() call.
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      inputRefs.current[i + 1]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      inputRefs.current[i - 1]?.focus();
    }
  }

  async function onCreate() {
    if (!target) return;
    const created = await create.run({ classId: target.classId, subjectId: target.subjectId, kind, name, academicYear: year, maxScore: Number(maxScore) });
    if (created) {
      setActive(created);
      setName("");
      setScores({});
      toast.push({ status: "good", message: `Assessment "${created.name}" created.` });
    }
  }
  async function onEnter() {
    if (!active || hasErrors) return;
    const entries = roster.filter((s) => scores[s.id] !== undefined && scores[s.id] !== "").map((s) => ({ studentId: s.id, score: Number(scores[s.id]) }));
    if (entries.length > 0) {
      const result = await enter.run(active.id, entries);
      if (result) toast.push({ status: "good", message: "Marks saved." });
    }
  }

  if (targets.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Marks"
          title="Enter marks"
          lede="Create an assessment for your subject, then enter each student's score."
          help={<HelpButton slug="marks" />}
        />
        <DeniedState title="No subject you teach." message="Marks are entered by a subject teacher." />
      </>
    );
  }

  const columns: TableColumn<Row>[] = [
    { key: "name", header: "Assessment" },
    { key: "kind", header: "Kind" },
    { key: "max", header: "Max", figure: true },
    { key: "actions", header: "" },
  ];
  const rows: Row[] = (assessments ?? []).map((a) => ({
    name: a.name,
    kind: a.kind,
    max: a.maxScore,
    actions: <Button variant="ghost" onClick={() => setActive(a)}>Enter scores</Button>,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Marks"
        title="Enter marks"
        lede="Create an assessment for your subject, then enter each student's score."
        help={<HelpButton slug="marks" />}
      />

      <div className={styles.targetPicker}>
        <Select
          id="mk-target"
          label="Class · subject"
          value={targetIdx}
          onChange={(event) => {
            setTargetIdx(Number(event.target.value));
            setActive(null);
          }}
          options={targets.map((t, i) => ({ value: String(i), label: t.label }))}
        />
      </div>

      <Card title="New assessment">
        <div className={styles.formRow}>
          <Input id="mk-name" label="Assessment name" value={name} onChange={(event) => setName(event.target.value)} />
          <Select
            id="mk-kind"
            label="Kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as AssessmentKind)}
            options={KINDS.map((k) => ({ value: k, label: k }))}
          />
          <Input id="mk-max" label="Max score" type="number" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} />
        </div>
        <div className={styles.formActions}>
          <Button onClick={() => void onCreate()} loading={create.phase.name === "saving"} disabled={name.trim() === ""}>
            Create assessment
          </Button>
          {create.phase.name === "error" ? <span className="formerror" role="alert">{create.phase.message}</span> : null}
        </div>
      </Card>

      {active ? (
        <Card
          title={`${active.name} · out of ${active.maxScore}`}
          actions={<span className={`num ${styles.progress}`} aria-live="polite">{enteredCount}/{roster.length}</span>}
        >
          <div className={styles.scoreList}>
            {roster.map((s, i) => {
              const error = rowErrors[s.id] ?? null;
              return (
                <div key={s.id} className={styles.scoreRow}>
                  <span><strong>{s.fullName}</strong> <span className="num">{s.admissionNo}</span></span>
                  <span className={styles.scoreInputWrap}>
                    <input
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="number"
                      inputMode="numeric"
                      enterKeyHint={i < roster.length - 1 ? "next" : "done"}
                      min={0}
                      max={active.maxScore}
                      value={scores[s.id] ?? ""}
                      className={styles.scoreInput}
                      onChange={(event) => setScores((sc) => ({ ...sc, [s.id]: event.target.value }))}
                      onKeyDown={(event) => onRowKeyDown(event, i)}
                      aria-label={`score for ${s.fullName}`}
                      aria-invalid={error !== null}
                    />
                    {error !== null ? <span className="formerror" role="alert">{error}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={styles.formActions}>
            <Button onClick={() => void onEnter()} loading={enter.phase.name === "saving"} disabled={hasErrors}>Save marks</Button>
            {enter.phase.name === "error" ? <span className="formerror" role="alert">{enter.phase.message}</span> : null}
          </div>
        </Card>
      ) : (
        <section className="section" aria-label="Existing assessments">
          <div className="section-head">
            <h2>Existing assessments</h2>
            {assessments !== null ? <span className="stat-sub num">{assessments.length}</span> : null}
          </div>
          <AsyncState
            loading={assessments === null && !assessmentsError}
            error={assessmentsError}
            onRetry={() => void loadAssessments()}
            isEmpty={assessments !== null && assessments.length === 0}
            empty={<EmptyState title="No assessments yet." body="Create one above." />}
          >
            <Table columns={columns} rows={rows} />
          </AsyncState>
        </section>
      )}
    </>
  );
}
