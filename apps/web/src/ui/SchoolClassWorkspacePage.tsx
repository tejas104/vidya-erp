"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState, Input, Modal, PageHeader, Select, StatusBadge, useToast } from "@vidya/ui-system";
import { api, ApiError, currentAcademicYear, type Dashboard, type RosterCard, type StudentView } from "./api";
import { AsyncState } from "./AsyncState";
import { HelpButton } from "./help/HelpButton";
import styles from "./SchoolClassWorkspacePage.module.css";

type Choice = {
  key: string;
  classId: string;
  sectionId: string;
  label: string;
  subjectId?: string;
  subjectName?: string;
  homeroom: boolean;
};

function classChoices(dashboard: Dashboard): Choice[] {
  return dashboard.tiles.flatMap((tile) => {
    if (tile.type !== "class" && tile.type !== "teacher-class") return [];
    return tile.strip.map((section) => {
      const subjectId = tile.type === "teacher-class" ? tile.subjectId : undefined;
      const subjectName = subjectId ? dashboard.names[subjectId] ?? "Subject" : undefined;
      const label = `${dashboard.names[tile.classId] ?? "Class"} · ${section.name}${subjectName ? ` · ${subjectName}` : ""}`;
      return {
        key: `${section.sectionId}:${subjectId ?? "class"}`,
        classId: tile.classId,
        sectionId: section.sectionId,
        label,
        subjectId,
        subjectName,
        homeroom: tile.type === "class",
      };
    });
  });
}

export function SchoolClassWorkspacePage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [choiceError, setChoiceError] = useState(false);
  const [choicesReload, setChoicesReload] = useState(0);
  const [students, setStudents] = useState<StudentView[] | null>(null);
  const [attendance, setAttendance] = useState<Map<string, RosterCard>>(new Map());
  const [rosterError, setRosterError] = useState(false);
  const [rosterReload, setRosterReload] = useState(0);
  const [query, setQuery] = useState("");
  const [onlyUnrecorded, setOnlyUnrecorded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [admissionNo, setAdmissionNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setChoiceError(false);
    api.dashboard(year).then((dashboard) => {
      if (!live) return;
      const next = classChoices(dashboard);
      setChoices(next);
      setSelectedKey((current) => next.some((item) => item.key === current) ? current : next[0]?.key ?? "");
    }).catch(() => { if (live) setChoiceError(true); });
    return () => { live = false; };
  }, [year, choicesReload]);

  const choice = choices?.find((item) => item.key === selectedKey);
  useEffect(() => {
    if (!choice) return;
    let live = true;
    setStudents(null);
    setAttendance(new Map());
    setRosterError(false);
    Promise.all([
      api.sectionRoster(choice.sectionId),
      api.rosterAttendance(choice.sectionId, { academicYear: year, ...(choice.subjectId ? { subjectId: choice.subjectId } : {}) }),
    ]).then(([roster, result]) => {
      if (!live) return;
      setStudents(roster.students);
      setAttendance(new Map(result.cards.map((card) => [card.studentId, card])));
    }).catch(() => { if (live) setRosterError(true); });
    return () => { live = false; };
  }, [choice, year, rosterReload]);

  async function addPupil() {
    if (!choice?.homeroom || !admissionNo.trim() || !fullName.trim() || saving) return;
    setSaving(true);
    try {
      const { colleges } = await api.colleges();
      const collegeId = students?.[0]?.collegeId ?? colleges[0]?.id;
      if (!collegeId) throw new Error("School unavailable");
      await api.createStudent({ collegeId, admissionNo: admissionNo.trim(), fullName: fullName.trim(), sectionId: choice.sectionId, academicYear: year });
      toast.push({ status: "good", message: `${fullName.trim()} added to ${choice.label}.` });
      setAdding(false);
      setAdmissionNo("");
      setFullName("");
      setRosterReload((count) => count + 1);
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't add this pupil. Check the admission number and try again." });
    } finally { setSaving(false); }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visible = (students ?? []).filter((student) => {
    const matches = !normalizedQuery || `${student.fullName} ${student.admissionNo}`.toLowerCase().includes(normalizedQuery);
    return matches && (!onlyUnrecorded || (attendance.get(student.id)?.total ?? 0) === 0);
  });
  const recorded = (students ?? []).filter((student) => (attendance.get(student.id)?.total ?? 0) > 0).length;

  return <>
    <PageHeader eyebrow="Teaching" title="My class register" lede="Choose a class, take attendance, and open a pupil's record when you need it." help={<HelpButton slug="classes" />} />
    <AsyncState loading={choices === null && !choiceError} error={choiceError} errorMessage="Couldn't load your assigned classes." onRetry={() => setChoicesReload((count) => count + 1)} isEmpty={choices?.length === 0} empty={<EmptyState title="No class assigned yet" body="Ask your school office to assign a class or teaching subject to your staff record." />}>
      {choice ? <div className={styles.stack}>
        <div className={styles.topline}>
          <Select id="school-class" label="Class and section" value={selectedKey} onChange={(event) => { setSelectedKey(event.target.value); setOnlyUnrecorded(false); setQuery(""); }} options={(choices ?? []).map((item) => ({ value: item.key, label: item.label }))} />
          <span className={styles.scope}>{choice.homeroom ? "Class teacher register" : `${choice.subjectName ?? "Subject"} register`}</span>
        </div>
        <div className={styles.hero}>
          <div><span className={styles.eyebrow}>Your selected class</span><h2>{choice.label}</h2><p>{choice.homeroom ? "Whole-class attendance and pupil records" : "Attendance for your subject in this section"}</p></div>
          <div className={styles.heroActions}>
            <a className={styles.primary} href={`/manage/attendance?sectionId=${encodeURIComponent(choice.sectionId)}${choice.subjectId ? `&subjectId=${encodeURIComponent(choice.subjectId)}` : ""}`}>Take attendance <span aria-hidden="true">→</span></a>
            {choice.subjectId ? <a className={styles.secondary} href="/manage/marks">Enter marks</a> : <a className={styles.secondary} href="/manage/report-cards">Report cards</a>}
          </div>
        </div>
        <AsyncState loading={students === null && !rosterError} error={rosterError} errorMessage="Couldn't load this class register." onRetry={() => setRosterReload((count) => count + 1)}>
          {students ? <section className={styles.roster} aria-label="Pupil register">
            <div className={styles.rosterHeading}>
              <div><span className={styles.eyebrow}>{year}</span><h2>Pupil register</h2><p>{students.length} pupils · {recorded} with attendance recorded{choice.subjectId ? " in this subject" : ""}</p></div>
              {choice.homeroom ? <Button onClick={() => setAdding(true)}>Add pupil</Button> : null}
            </div>
            <div className={styles.filters}>
              <Input id="school-class-search" label="Find a pupil" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or admission number" />
              <label className={styles.filter}><input type="checkbox" checked={onlyUnrecorded} onChange={(event) => setOnlyUnrecorded(event.target.checked)} /> No attendance yet</label>
            </div>
            {students.length === 0 ? <EmptyState title="No pupils enrolled" body={choice.homeroom ? "Use Add pupil above, or ask the school office to enrol this class." : "Ask the school office to enrol pupils in this section."} /> : visible.length === 0 ? <EmptyState title="No pupils match" body="Clear the search or attendance filter to see the full register." /> :
              <ul className={styles.rows}>{visible.map((student) => {
                const card = attendance.get(student.id);
                return <li key={student.id}>
                  <a href={`/students/${encodeURIComponent(student.id)}`} className={styles.pupil}>
                    <span className={styles.avatar} aria-hidden="true">{student.fullName.trim().charAt(0).toUpperCase()}</span>
                    <span className={styles.pupilName}><strong>{student.fullName}</strong><small>Admission {student.admissionNo}</small></span>
                    <span className={styles.attendance}>{card && card.total > 0 ? <><strong>{card.pct === null ? "Recorded" : `${Math.round(card.pct)}%`}</strong><small>{card.total} attendance entries</small></> : <StatusBadge status="neutral">Not recorded</StatusBadge>}</span>
                    <span className={styles.arrow} aria-hidden="true">↗</span>
                  </a>
                </li>;
              })}</ul>}
          </section> : null}
        </AsyncState>
      </div> : null}
    </AsyncState>
    <Modal open={adding} onClose={() => setAdding(false)} title={`Add pupil to ${choice?.label ?? "class"}`} footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={() => void addPupil()} loading={saving} disabled={!admissionNo.trim() || !fullName.trim()}>Add pupil</Button></>}>
      <div className={styles.modalFields}>
        <p>Creates an audited pupil record and enrols them in this section for {year}.</p>
        <Input id="school-admission" label="Admission number" value={admissionNo} onChange={(event) => setAdmissionNo(event.target.value)} />
        <Input id="school-pupil-name" label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
      </div>
    </Modal>
  </>;
}
