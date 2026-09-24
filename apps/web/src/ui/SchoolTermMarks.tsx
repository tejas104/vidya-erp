"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState, StatusBadge, Tabs } from "@vidya/ui-system";
import { api, ApiError, type SchoolPortalMarks } from "./api";
import { AsyncState } from "./AsyncState";
import styles from "./SchoolTermMarks.module.css";

type Term = SchoolPortalMarks["terms"][number];
type Load = { state: "loading" } | { state: "denied" } | { state: "error" } | { state: "ok"; terms: Term[] };

export function SchoolTermMarks({ academicYear, studentId }: { academicYear: string; studentId?: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [selected, setSelected] = useState("");
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoad({ state: "loading" });
    const request = studentId === undefined ? api.portalSchoolMarks(academicYear) : api.childSchoolMarks(studentId, academicYear);
    request.then(({ terms }) => {
      if (!active) return;
      setLoad({ state: "ok", terms });
      setSelected((current) => terms.some((term) => term.termId === current) ? current : terms[0]?.termId ?? "");
    }).catch((error: unknown) => {
      if (!active) return;
      setLoad(error instanceof ApiError && error.status === 403 ? { state: "denied" } : { state: "error" });
    });
    return () => { active = false; };
  }, [academicYear, studentId, version]);

  if (load.state === "denied") return null;
  const term = load.state === "ok" ? load.terms.find((item) => item.termId === selected) ?? load.terms[0] : undefined;

  return <section id={studentId === undefined ? "portal-marks" : undefined} className="section" aria-label="School term marks">
    <div className="section-head"><h2>{studentId === undefined ? "My term marks" : "Term marks"}</h2><span className="stat-sub">{academicYear}</span></div>
    <AsyncState loading={load.state === "loading"} error={load.state === "error"} onRetry={refresh} errorMessage="Couldn't load term marks.">
      {load.state === "ok" && load.terms.length === 0 ?
        <EmptyState title="No term marks released yet." body="Marks appear when the school releases a closed term. Open terms stay private while teachers enter and correct scores." /> : null}
      {load.state === "ok" && term !== undefined ? <>
        {load.terms.length > 1 ? <div className={styles.tabs}><Tabs tabs={load.terms.map((item) => ({ id: item.termId, label: item.termName }))} active={term.termId} onChange={setSelected} /></div> : null}
        <Card>
          <div className={styles.heading}>
            <div><p className={styles.eyebrow}>Closed term · {term.endsOn}</p><h3>{term.termName}</h3></div>
            <div className={styles.overall}><span>Overall result</span><strong>{term.overallPct === null ? "Incomplete" : `${term.overallPct.toFixed(2)}%`}</strong></div>
          </div>
          {term.subjects.length === 0 ? <p className={styles.note}>No assessments are recorded for this term and class.</p> :
            <ul className={styles.subjects}>{term.subjects.map((subject) => <li key={subject.subjectId} className={styles.subject}>
              <div className={styles.subjectHead}>
                <div><strong>{subject.name}</strong><small>{subject.recordedCount} of {subject.assessmentCount} marks recorded</small></div>
                <div className={styles.result}>{subject.percentage === null ? <StatusBadge status="warn">{subject.status === "unavailable" ? "Unavailable" : "Incomplete"}</StatusBadge> : <strong>{subject.percentage.toFixed(2)}%</strong>}</div>
              </div>
              <details className={styles.details}><summary>View assessments</summary><ul>{subject.assessments.map((assessment) => <li key={assessment.assessmentId} className={styles.assessment}>
                <span><strong>{assessment.name}</strong><small>{assessment.typeName} · {assessment.heldOn}</small></span>
                <span className={styles.score}>{assessment.score === null ? assessment.status === "missing" ? "Not recorded" : assessment.status : `${assessment.score}/${assessment.maxScore}`}</span>
              </li>)}</ul></details>
            </li>)}</ul>}
          {!term.complete && term.subjects.length > 0 ? <p className={styles.note}>The overall result stays unavailable until every subject has a complete, valid set of marks. Missing marks are never counted as zero.</p> : null}
        </Card>
      </> : null}
    </AsyncState>
  </section>;
}
