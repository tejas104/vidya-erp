"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, api, type GradeBand, type GradeScaleView } from "./api";
import { Button, EmptyState, Input, Modal, PageHeader, Skeleton, StatusBadge, useToast } from "@vidya/ui-system";
import { bandsProblem } from "../../app/(app)/manage/results/CollegeResultsPage";
import { HelpButton } from "./help/HelpButton";
import styles from "./SchoolResultsPage.module.css";

const DEFAULT_BANDS: GradeBand[] = [
  { minPct: 90, grade: "A+", points: 10 }, { minPct: 80, grade: "A", points: 9 },
  { minPct: 70, grade: "B+", points: 8 }, { minPct: 60, grade: "B", points: 7 },
  { minPct: 50, grade: "C", points: 6 }, { minPct: 40, grade: "D", points: 5 },
  { minPct: 0, grade: "F", points: 0 },
];

export function SchoolResultsPage() {
  const toast = useToast();
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [scales, setScales] = useState<GradeScaleView[] | null>(null);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("School grades");
  const [bands, setBands] = useState<GradeBand[]>(DEFAULT_BANDS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void api.colleges().then(async ({ colleges }) => {
      const college = colleges[0];
      if (!college) throw new Error("No school configured");
      const [result, session] = await Promise.all([api.resScales(college.id), api.session()]);
      if (live) { setCollegeId(college.id); setScales(result.scales); setCanManage(session.roles.includes("admin")); }
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, []);

  function changeBand(index: number, patch: Partial<GradeBand>) {
    setBands((current) => current.map((band, i) => i === index ? { ...band, ...patch } : band));
  }

  async function createScale() {
    if (!collegeId || !name.trim() || bandsProblem(bands)) return;
    setSaving(true);
    try {
      const scale = await api.resCreateScale({ collegeId, name: name.trim(), bands });
      setScales((current) => [...(current ?? []), scale]);
      setCreating(false);
      toast.push({ status: "good", message: "Grade scale saved." });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't save the grade scale." });
    } finally { setSaving(false); }
  }

  const problem = bandsProblem(bands);
  return <>
    <PageHeader eyebrow="School results" title="From marks to report cards" lede="Set up the term, record assessments, then review each report card before publishing it to families." help={<HelpButton slug="results" />} />
    <div className={styles.steps}>
      <Link href="/manage/terms" className={styles.step}><span>01 · Set up</span><strong>Academic terms</strong><small>Dates and assessment types</small></Link>
      <Link href="/manage/marks" className={styles.step}><span>02 · Record</span><strong>Marks</strong><small>Class and subject assessments</small></Link>
      <Link href="/manage/report-cards" className={styles.step}><span>03 · Review</span><strong>Report cards</strong><small>Preview, generate and publish</small></Link>
    </div>
    <section className="section" aria-label="Grade scales">
      <div className="section-head"><h2>Grading rules</h2>{canManage ? <Button variant="ghost" onClick={() => { setName("School grades"); setBands(DEFAULT_BANDS); setCreating(true); }}>New grade scale</Button> : null}</div>
      <p className={styles.explain}>The scale chosen for a term determines its letter grades. Grading rules are retained for school records; create a new scale when the rules change.</p>
      {error ? <EmptyState title="Couldn't load grading rules" body="Reload the page and try again." /> : scales === null ? <Skeleton height={16} /> : scales.length === 0 ? <EmptyState title="No grading rule yet" body="Create a grade scale before recording assessment marks." /> :
        <div className={styles.scales}>{scales.map((scale) => <div className={styles.scale} key={scale.id}>
          <div><strong>{scale.name}</strong> {scale.locked ? <StatusBadge status="neutral">in use</StatusBadge> : null}<p>{[...scale.bands].sort((a, b) => b.minPct - a.minPct).map((band) => `${band.minPct}% ${band.grade}`).join(" · ")}</p></div>
        </div>)}</div>}
    </section>
    <Modal open={creating} onClose={() => setCreating(false)} title="New grade scale" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={() => void createScale()} loading={saving} disabled={!name.trim() || problem !== null}>Save scale</Button></>}>
      <div className={styles.form}>
        <Input id="school-scale-name" label="Scale name" value={name} onChange={(event) => setName(event.target.value)} />
        <p className={styles.explain}>Minimum percentage is inclusive. Each band applies up to the next band. Points are kept for the shared grading engine.</p>
        <div className={styles.bandHead}><span>Minimum %</span><span>Grade</span><span>Points</span></div>
        {bands.map((band, index) => <div key={index} className={styles.band}>
          <input aria-label={`Band ${index + 1} minimum %`} type="number" min="0" max="100" value={band.minPct} onChange={(event) => changeBand(index, { minPct: Number(event.target.value) })} />
          <input aria-label={`Band ${index + 1} grade`} maxLength={8} value={band.grade} onChange={(event) => changeBand(index, { grade: event.target.value })} />
          <input aria-label={`Band ${index + 1} points`} type="number" min="0" max="10" value={band.points} onChange={(event) => changeBand(index, { points: Number(event.target.value) })} />
        </div>)}
        {problem ? <p role="alert" className={styles.problem}>{problem}</p> : null}
      </div>
    </Modal>
  </>;
}
