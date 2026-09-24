"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, currentAcademicYear, type AttendanceStatus, type SessionSummary, type SessionView } from "@/ui/api";
import { useMutation } from "@/ui/useMutation";
import { DeniedState } from "@/ui/DeniedState";
import { AsyncState } from "@/ui/AsyncState";
import { Icon } from "@/ui/Icon";
import { AVATARS, initials } from "@/ui/avatar";
import { useToast, Button, EmptyState, Input, PageHeader, Select, StatusBadge } from "@vidya/ui-system";
import { HelpButton } from "@/ui/help/HelpButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
type SectionOpt = { key: string; sectionId: string; name: string; className: string; subjectId?: string; subjectName?: string };
type Student = { id: string; fullName: string; admissionNo: string };

/** Tap toggles present<->absent (the fast path); late/excused are a secondary
 * control (the per-cell <select>) so they never cost the primary flow a tap. */
function toggleAbsent(cur: AttendanceStatus): AttendanceStatus {
  return cur === "present" ? "absent" : "present";
}
function fromSecondary(value: string): AttendanceStatus {
  return value === "late" || value === "excused" ? value : "present";
}

export default function AttendancePage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [sections, setSections] = useState<SectionOpt[]>([]);
  const [sectionsLoaded, setSectionsLoaded] = useState(false);
  const [sectionsError, setSectionsError] = useState(false);
  const [targetKey, setTargetKey] = useState("");
  const [heldOn, setHeldOn] = useState(today);
  const [slot, setSlot] = useState("day");
  const [roster, setRoster] = useState<Student[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [daySessions, setDaySessions] = useState<SessionSummary[] | null>(null);
  const [daySessionsError, setDaySessionsError] = useState(false);
  const [savedSession, setSavedSession] = useState<SessionView | null>(null);
  const [savedSessionError, setSavedSessionError] = useState(false);
  const [search, setSearch] = useState("");
  const save = useMutation(api.recordAttendance);
  const toast = useToast();

  useEffect(() => {
    api.dashboard(year).then((dash) => {
      const opts: SectionOpt[] = [];
      for (const tile of dash.tiles) {
        if (tile.type === "class" || tile.type === "teacher-class") {
          const className = dash.names[tile.classId] ?? tile.classId;
          const subjectId = tile.type === "teacher-class" ? tile.subjectId : undefined;
          for (const s of tile.strip) opts.push({ key: `${s.sectionId}:${subjectId ?? "class"}`, sectionId: s.sectionId, name: s.name, className, subjectId, subjectName: subjectId ? dash.names[subjectId] ?? "Subject" : undefined });
        }
      }
      setSections(opts);
      setSectionsLoaded(true);
      const params = new URLSearchParams(window.location.search);
      const wanted = params.get("sectionId");
      const wantedSubject = params.get("subjectId");
      const wantedDate = params.get("date");
      const selected = opts.find((o) => o.sectionId === wanted && (o.subjectId ?? "") === (wantedSubject ?? "")) ?? opts.find((o) => o.sectionId === wanted) ?? opts[0];
      if (selected) setTargetKey(selected.key);
      if (wantedDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(wantedDate)) setHeldOn(wantedDate);
      const wantedSlot = params.get("slot");
      if (wantedSlot !== null && wantedSlot.trim() !== "") setSlot(wantedSlot);
      else if (selected?.subjectId) setSlot("p1");
    }).catch(() => { setSectionsError(true); setSectionsLoaded(true); });
  }, [year]);

  const target = sections.find((option) => option.key === targetKey);
  const sectionId = target?.sectionId ?? "";
  const subjectId = target?.subjectId ?? "";
  const loadRoster = useCallback(() => {
    if (!sectionId) return;
    setRoster(null);
    setRosterError(false);
    let live = true;
    api.sectionRoster(sectionId).then((r) => {
      if (!live) return;
      setRoster(r.students);
      setMarks(Object.fromEntries(r.students.map((s) => [s.id, "present" as AttendanceStatus])));
    }).catch(() => {
      if (!live) return;
      setRoster(null);
      setRosterError(true);
    });
    return () => { live = false; };
  }, [sectionId]);
  useEffect(() => {
    return loadRoster();
  }, [loadRoster]);

  const loadDaySessions = useCallback(() => {
    if (!sectionId || !heldOn) return;
    setDaySessions(null);
    setDaySessionsError(false);
    let live = true;
    api.sessionAttendance(sectionId, { from: heldOn, to: heldOn, limit: 100 })
      .then(({ sessions }) => { if (live) setDaySessions(sessions); })
      .catch(() => { if (live) { setDaySessions(null); setDaySessionsError(true); } });
    return () => { live = false; };
  }, [sectionId, heldOn]);
  useEffect(() => loadDaySessions(), [loadDaySessions]);

  const existingSession = daySessions?.find((session) =>
    session.heldOn === heldOn && session.slot === slot && (session.subjectId ?? "") === subjectId,
  );
  useEffect(() => {
    if (!existingSession) { setSavedSession(null); setSavedSessionError(false); return; }
    let live = true;
    setSavedSession(null);
    setSavedSessionError(false);
    api.getSession(existingSession.id).then((result) => { if (live) setSavedSession(result); }).catch(() => { if (live) setSavedSessionError(true); });
    return () => { live = false; };
  }, [existingSession?.id]);

  async function submit() {
    const saved = await save.run({
      sectionId, heldOn, slot, academicYear: year,
      ...(subjectId !== "" ? { subjectId } : {}),
      entries: (roster ?? []).map((s) => ({ studentId: s.id, status: marks[s.id] ?? "present" })),
    });
    if (saved) {
      toast.push({ status: "good", message: "Attendance saved — recompute analytics to see it on the dashboard." });
      loadDaySessions();
    }
  }

  const rosterList = roster ?? [];
  const tally = (st: AttendanceStatus) => rosterList.filter((s) => (marks[s.id] ?? "present") === st).length;
  const presentN = tally("present");
  const absentN = tally("absent");
  const lateN = tally("late");
  const excusedN = tally("excused");
  const q = search.trim().toLowerCase();
  const visibleRoster = rosterList.filter((student) => !q || `${student.fullName} ${student.admissionNo}`.toLowerCase().includes(q));
  const savedStatuses = new Map(savedSession?.entries.map((entry) => [entry.studentId, entry.status]) ?? []);
  const slotOptions = [
    ...(target?.subjectId ? [] : [{ value: "day", label: "Daily class register" }]),
    ...Array.from({ length: 8 }, (_, index) => ({ value: `p${index + 1}`, label: `Period ${index + 1}` })),
    ...(!/^p[1-8]$/.test(slot) && slot !== "day" ? [{ value: slot, label: slot }] : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Attendance"
        title="Class attendance"
        lede="Choose the class and register, mark exceptions, then save the complete roster."
        help={<HelpButton slug="attendance" />}
      />

      {!sectionsLoaded ? <p className="page-lede">Loading your classes…</p> : sectionsError ? (
        <EmptyState title="Couldn't load your classes" body="Reload the page to try again." />
      ) : sections.length === 0 ? (
        <DeniedState title="No sections you can record for." message="Open a period from your Today card to mark its attendance." />
      ) : (
        <>
          <section className={styles.context} aria-label="Register details">
            <div className={styles.contextHeading}>
              <span className={styles.eyebrow}>Selected register</span>
              <strong>{target ? `${target.className} · ${target.name}` : "Choose a class"}</strong>
              <span>{target?.subjectName ? `${target.subjectName} · ${year}` : `Whole class · ${year}`}</span>
            </div>
            <div className={styles.filterRow}>
              <div className={styles.sectionField}>
              <Select
                id="att-section"
                label="Class and subject"
                value={targetKey}
                onChange={(e) => { const next = sections.find((option) => option.key === e.target.value); setTargetKey(e.target.value); setSlot(next?.subjectId ? "p1" : "day"); setSearch(""); }}
                options={sections.map((s) => ({ value: s.key, label: `${s.className} · ${s.name}${s.subjectName ? ` · ${s.subjectName}` : " · Whole class"}` }))}
              />
              </div>
              <div className={styles.dateField}><Input id="att-date" label="Date" type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></div>
              <div className={styles.slotField}><Select id="att-slot" label="Register" value={slot} onChange={(e) => setSlot(e.target.value)} options={slotOptions} /></div>
            </div>
          </section>

          <AsyncState
            loading={roster === null && !rosterError}
            error={rosterError}
            onRetry={loadRoster}
            isEmpty={roster !== null && roster.length === 0}
            empty={<EmptyState title="No students enrolled in this section." />}
          >
            {daySessionsError ? <p role="alert" className="formerror">Couldn't check saved registers for this date. <Button variant="ghost" size="sm" onClick={loadDaySessions}>Retry check</Button></p> : null}
            <section className={styles.register} aria-label="Pupil attendance register">
              <div className={styles.registerHead}>
                <div><span className={styles.eyebrow}>{existingSession ? "Saved register" : "Ready to record"}</span><h2>{existingSession ? "Attendance recorded" : "Mark the class"}</h2><p>{existingSession ? "This register is saved. Review each pupil below; corrections are audited." : `All ${rosterList.length} pupils start present. Mark absences or choose an exception.`}</p></div>
                {!existingSession ? <Button variant="secondary" size="sm" onClick={() => setMarks(Object.fromEntries(rosterList.map((s) => [s.id, "present" as AttendanceStatus])))}>All present</Button> : null}
              </div>
              <div className={styles.summary} aria-live="polite">
                <StatusBadge status="good">{existingSession?.counts.present ?? presentN} present</StatusBadge>
                <StatusBadge status="danger">{existingSession?.counts.absent ?? absentN} absent</StatusBadge>
                <StatusBadge status="warn">{existingSession?.counts.late ?? lateN} late</StatusBadge>
                <StatusBadge status="neutral">{existingSession?.counts.excused ?? excusedN} excused</StatusBadge>
                <span className={styles.summaryNote}>{rosterList.length} pupils in this section</span>
              </div>
              <div className={styles.searchRow}><Input id="att-search" label="Find a pupil" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or admission number" /><span>{visibleRoster.length} of {rosterList.length} shown · Search only filters the list</span></div>
              {existingSession && !savedSession ? <p className={styles.savedMessage}>{savedSessionError ? "Couldn't load pupil statuses for this saved register. Reload the page to retry." : "Loading saved pupil statuses…"}</p> : visibleRoster.length === 0 ? <EmptyState title="No pupils match" body="Clear the search to see the full register." /> :
              <ul className={styles.rows}>
                {visibleRoster.map((s) => {
                  const index = rosterList.findIndex((student) => student.id === s.id);
                  const av = AVATARS[index % AVATARS.length]!;
                  const cur = existingSession ? savedStatuses.get(s.id) : marks[s.id] ?? "present";
                  const status = cur ?? "not recorded";
                  const pressed: boolean | "mixed" = cur === "present" ? false : cur === "absent" ? true : "mixed";
                  return <li key={s.id} className={styles.row}>
                    <span className={styles.avatar} style={{ background: av.gradient, color: av.ink }} aria-hidden="true">{initials(s.fullName)}</span>
                    <span className={styles.person}><strong>{s.fullName}</strong><small>{s.admissionNo}</small></span>
                    {existingSession ? <span className={styles.savedStatus} data-status={status}>{status}</span> : <div className={styles.controls}>
                      <button type="button" className={styles.statusButton} data-status={cur} aria-pressed={pressed} aria-label={`${s.fullName}, roll ${s.admissionNo} — ${cur}; mark ${cur === "present" ? "absent" : "present"}`} title={`Mark ${s.fullName} ${cur === "present" ? "absent" : "present"}`} onClick={() => setMarks((current) => ({ ...current, [s.id]: toggleAbsent(current[s.id] ?? "present") }))}>
                        {cur === "absent" ? <Icon name="close" size={14} /> : <Icon name="check" size={14} />}{cur}
                      </button>
                      <select className={styles.secondary} aria-label={`Mark ${s.fullName} late or excused`} value={cur === "late" || cur === "excused" ? cur : ""} onChange={(event) => setMarks((current) => ({ ...current, [s.id]: fromSecondary(event.target.value) }))}>
                        <option value="">More…</option><option value="late">Late</option><option value="excused">Excused</option>
                      </select>
                    </div>}
                  </li>;
                })}
              </ul>}
            </section>
            {!existingSession ? <div className={styles.saveBar}>
              <span><strong>{rosterList.length} pupil records</strong><small>{daySessions === null ? "Checking for an existing register…" : "Review the totals before saving."}</small></span>
              <Button disabled={save.phase.name === "saving" || daySessions === null || daySessionsError} onClick={submit}>{save.phase.name === "saving" ? "Saving…" : "Save attendance"}</Button>
              {save.phase.name === "error" ? <span className="formerror" role="alert">{save.phase.message}</span> : null}
            </div> : null}
          </AsyncState>
        </>
      )}
    </>
  );
}
