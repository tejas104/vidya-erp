"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { ScoreEntryCard } from "@/ui/ScoreEntryCard";
import { HelpButton } from "@/ui/help/HelpButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
const KINDS: AssessmentKind[] = ["quiz", "exam", "assignment"];
type Target = { classId: string; subjectId: string; label: string; sectionId?: string };
type Student = { id: string; fullName: string; admissionNo: string };
type Row = { name: ReactNode; kind: ReactNode; max: ReactNode; actions: ReactNode };

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
  async function onEnter(entries: { studentId: string; score: number }[]) {
    if (!active) return;
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
        <ScoreEntryCard
          title={`${active.name} · out of ${active.maxScore}`}
          roster={roster}
          values={scores}
          maxScore={active.maxScore}
          onChange={(studentId, value) => setScores((sc) => ({ ...sc, [studentId]: value }))}
          onSave={(entries) => void onEnter(entries)}
          saving={enter.phase.name === "saving"}
          error={enter.phase.name === "error" ? enter.phase.message : null}
        />
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
