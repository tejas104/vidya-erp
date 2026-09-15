"use client";
import { useEffect, useState } from "react";
import { Button, Card, EmptyState, Input, PageHeader, Select, StatusBadge, Table, useToast } from "@vidya/ui-system";
import { api, ApiError, currentAcademicYear, type SchoolAssessmentView, type SchoolClassSetup, type SchoolMarkView } from "./api";
import { AsyncState } from "./AsyncState";
import { ScoreEntryCard, type ScoreEntryStudent } from "./ScoreEntryCard";
import { schoolVocabulary } from "./editionVocabulary";
import styles from "./SchoolMarksPage.module.css";

type Target = { key: string; classId: string; subjectId: string; sectionId: string; label: string };

export function SchoolMarksPage() {
  const toast = useToast();
  const [year] = useState(currentAcademicYear);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetKey, setTargetKey] = useState("");
  const [initialError, setInitialError] = useState(false);
  const [reload, setReload] = useState(0);
  const [setup, setSetup] = useState<SchoolClassSetup | null>(null);
  const [assessments, setAssessments] = useState<SchoolAssessmentView[]>([]);
  const [roster, setRoster] = useState<ScoreEntryStudent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [termId, setTermId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [scaleId, setScaleId] = useState("");
  const [name, setName] = useState("");
  const [maxScore, setMaxScore] = useState("20");
  const [heldOn, setHeldOn] = useState("");
  const [active, setActive] = useState<SchoolAssessmentView | null>(null);
  const [savedMarks, setSavedMarks] = useState<SchoolMarkView[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [marksLoading, setMarksLoading] = useState(false);
  const [marksReady, setMarksReady] = useState(false);
  const [termStatus, setTermStatus] = useState<"open" | "closed">("open");
  const [marksError, setMarksError] = useState<string | null>(null);
  const [marksReload, setMarksReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setInitialError(false);
    api.dashboard(year).then((dash) => {
      if (!alive) return;
      const choices = dash.tiles.flatMap((tile) => tile.type === "teacher-class" ? tile.strip.map((section) => ({ key: `${tile.classId}:${tile.subjectId}:${section.sectionId}`, classId: tile.classId, subjectId: tile.subjectId, sectionId: section.sectionId, label: `${dash.names[tile.classId] ?? tile.classId} · ${section.name} · ${dash.names[tile.subjectId] ?? tile.subjectId}` })) : []);
      setTargets(choices);
      setTargetKey((current) => choices.some((choice) => choice.key === current) ? current : choices[0]?.key ?? "");
    }).catch(() => { if (alive) setInitialError(true); });
    return () => { alive = false; };
  }, [year, reload]);

  const target = targets?.find((choice) => choice.key === targetKey);
  useEffect(() => {
    if (!target) return;
    let alive = true;
    setSetup(null);
    setLoadError(null);
    setActive(null);
    setCreateError(null);
    Promise.all([api.schoolClassSetup(target.classId, year), api.schoolAssessments(target.classId, year), api.sectionRoster(target.sectionId)]).then(([configuration, list, students]) => {
      if (!alive) return;
      setSetup(configuration);
      setAssessments(list.assessments.filter((assessment) => assessment.subjectId === target.subjectId));
      setRoster(students.students);
      setTermId((current) => configuration.terms.some((term) => term.id === current) ? current : configuration.terms.find((term) => term.status === "open")?.id ?? configuration.terms[0]?.id ?? "");
      setTypeId("");
      setScaleId("");
    }).catch((caught: unknown) => {
      if (alive) setLoadError(caught instanceof ApiError && caught.status === 403 ? "You don't have access to this class." : "Couldn't load the class setup. Please retry.");
    });
    return () => { alive = false; };
  }, [target, year, reload]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setMarksLoading(true);
    setMarksReady(false);
    setMarksError(null);
    setSavedMarks([]);
    setScores({});
    api.schoolMarks(active.id).then((result) => {
      if (!alive) return;
      setSavedMarks(result.marks);
      setScores(Object.fromEntries(result.marks.map((mark) => [mark.studentId, String(mark.score)])));
      setTermStatus(result.termStatus);
      setMarksReady(true);
    }).catch((caught: unknown) => { if (alive) setMarksError(caught instanceof ApiError ? caught.message : "Couldn't load marks. Please retry."); })
      .finally(() => { if (alive) setMarksLoading(false); });
    return () => { alive = false; };
  }, [active, marksReload]);

  const term = setup?.terms.find((item) => item.id === termId);
  const selectedType = term?.types.find((item) => item.id === typeId)?.id ?? term?.types[0]?.id ?? "";
  const selectedScale = term?.scaleId ?? (scaleId || setup?.scales[0]?.id || "");
  const scoreMaximum = Number(maxScore);
  const canCreate = !!target && !!term && term.status === "open" && !!selectedType && !!selectedScale && name.trim() !== "" && heldOn >= term.startsOn && heldOn <= term.endsOn && scoreMaximum > 0 && scoreMaximum <= 9999.99;

  async function create() {
    if (!canCreate || !target || !term || saving) return;
    setSaving(true);
    setCreateError(null);
    try {
      const created = await api.schoolCreateAssessment({ classId: target.classId, subjectId: target.subjectId, termId: term.id, typeId: selectedType, scaleId: selectedScale, name: name.trim(), maxScore: scoreMaximum, heldOn });
      setAssessments((current) => [...current, created]);
      setActive(created);
      setName("");
      // The server chose/snapshotted this exact basis; mirror it immediately.
      setSetup((current) => current ? { ...current, terms: current.terms.map((item) => item.id === term.id ? { ...item, scaleId: selectedScale, scaleName: current.scales.find((scale) => scale.id === selectedScale)?.name ?? item.scaleName } : item) } : current);
      toast.push({ status: "good", message: "Assessment created. Enter the class's marks below." });
    } catch (caught) { setCreateError(caught instanceof ApiError ? caught.message : "Couldn't create the assessment. Please retry."); }
    finally { setSaving(false); }
  }

  async function save(entries: { studentId: string; score: number }[]) {
    if (!active || saving) return;
    setSaving(true);
    setMarksError(null);
    try {
      const result = await api.schoolEnterMarks(active.id, entries);
      setSavedMarks((current) => [...current.filter((mark) => !result.marks.some((saved) => saved.studentId === mark.studentId)), ...result.marks]);
      toast.push({ status: "good", message: "Scores and grades saved." });
    } catch (caught) { setMarksError(caught instanceof ApiError ? caught.message : "Couldn't save marks. Please retry."); }
    finally { setSaving(false); }
  }

  return <>
    <PageHeader eyebrow="Academics" title="Enter marks" lede={`School assessments, term weights and recorded grades for the ${schoolVocabulary.academicYear.toLowerCase()}.`} />
    <AsyncState loading={targets === null && !initialError} error={initialError} onRetry={() => setReload((value) => value + 1)} isEmpty={targets?.length === 0} empty={<EmptyState title="No teaching subjects assigned" body="Your administrator can assign a subject and section to your staff record." />}>
      {target ? <>
        <Select label="Class, section and subject" value={targetKey} disabled={saving} onChange={(event) => setTargetKey(event.target.value)} options={(targets ?? []).map((choice) => ({ value: choice.key, label: choice.label }))} />
        <AsyncState loading={setup === null && loadError === null} error={loadError !== null} errorMessage={loadError} onRetry={() => setReload((value) => value + 1)}>
          {setup ? <div className={styles.stack}>
            {setup.terms.length === 0 ? <EmptyState title={`No ${schoolVocabulary.academicTerms.toLowerCase()} configured`} body={`Ask your administrator to create a term, assessment types and a grade scale for this ${schoolVocabulary.academicYear.toLowerCase()}.`} /> : <>
              <Select label={schoolVocabulary.term} value={termId} disabled={saving} onChange={(event) => { setTermId(event.target.value); setTypeId(""); setActive(null); setCreateError(null); }} options={setup.terms.map((item) => ({ value: item.id, label: `${item.name} · ${item.status}` }))} />
              {term?.status === "closed" ? <p className={styles.notice}>This term is closed. Recorded marks remain available below; an administrator must reopen it before corrections.</p> : term?.types.length === 0 ? <EmptyState title="Assessment types need setup" body="Ask your administrator to configure this term's percentage weights." /> : <Card title="Create assessment">
                <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
                  <fieldset className={styles.fields} disabled={saving}>
                    <div className={styles.grid}>
                      <Input label="Assessment name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
                      <Select label="Assessment type" value={selectedType} onChange={(event) => setTypeId(event.target.value)} options={(term?.types ?? []).map((type) => ({ value: type.id, label: `${type.name} · ${type.weight}%` }))} />
                      <Input label="Maximum score" type="number" min={0.01} max={9999.99} step={0.01} value={maxScore} onChange={(event) => setMaxScore(event.target.value)} required />
                      <Input label="Assessment date" type="date" min={term?.startsOn} max={term?.endsOn} value={heldOn} onChange={(event) => setHeldOn(event.target.value)} required />
                      <Select label="Grade scale" value={selectedScale} disabled={!!term?.scaleId} onChange={(event) => setScaleId(event.target.value)} options={term?.scaleId ? [{ value: term.scaleId, label: term.scaleName ?? "Saved term scale" }] : setup.scales.map((scale) => ({ value: scale.id, label: scale.name }))} />
                    </div>
                    <p className={styles.notice}>{selectedScale ? "The first assessment fixes this term's grade scale and weighting plan. Later scale edits will not change recorded school grades." : "Ask your administrator to create a grade scale under Results before creating assessments."}</p>
                    <Button type="submit" disabled={!canCreate} loading={saving}>Create assessment</Button>
                  </fieldset>
                  {createError ? <p className="formerror" role="alert">{createError}</p> : null}
                </form>
              </Card>}
              <Card title="Assessments">
                {assessments.filter((item) => item.termId === termId).length === 0 ? <EmptyState title="No assessments for this term" body="Create an assessment to begin entering marks." /> : <div className={styles.tableViewport}><Table columns={[{ key: "name", header: "Assessment" }, { key: "date", header: "Date" }, { key: "max", header: "Maximum", figure: true }, { key: "action", header: "Marks" }]}
                  rows={assessments.filter((item) => item.termId === termId).map((item) => ({ name: item.name, date: item.heldOn, max: item.maxScore, action: <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setActive(item); setMarksReload((value) => value + 1); }}>Open marks</Button> }))} /></div>}
              </Card>
            </>}
            {active ? <AsyncState loading={marksLoading} error={marksError !== null && !marksReady} errorMessage={marksError} onRetry={() => setMarksReload((value) => value + 1)}>
              {termStatus === "open" && roster.length > 0 ? <ScoreEntryCard title={active.name} roster={roster} values={scores} maxScore={active.maxScore} onChange={(id, value) => setScores((current) => ({ ...current, [id]: value }))} onSave={(entries) => void save(entries)} saving={saving} error={marksError} /> : <p className={styles.notice}>{termStatus === "closed" ? "Term closed · marks are read only." : "No students are enrolled in this section."}</p>}
              {savedMarks.length > 0 ? <Card title="Recorded grades"><div className={styles.tableViewport}><Table columns={[{ key: "name", header: "Student" }, { key: "score", header: "Score", figure: true }, { key: "percentage", header: "%", figure: true }, { key: "grade", header: "Grade" }]}
                rows={savedMarks.filter((mark) => roster.some((student) => student.id === mark.studentId)).map((mark) => ({ name: roster.find((student) => student.id === mark.studentId)?.fullName ?? "Student", score: `${mark.score}/${active.maxScore}`, percentage: mark.percentage, grade: <StatusBadge status="neutral">{mark.grade}</StatusBadge> }))} /></div></Card> : null}
            </AsyncState> : null}
          </div> : null}
        </AsyncState>
      </> : null}
    </AsyncState>
  </>;
}
