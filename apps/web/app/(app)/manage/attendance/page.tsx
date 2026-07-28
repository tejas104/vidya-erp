"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, currentAcademicYear, type AttendanceStatus, type RosterCard } from "@/ui/api";
import { useMutation } from "@/ui/useMutation";
import { StudentSlideOver, type DrawerStudent } from "@/ui/StudentSlideOver";
import { DeniedState } from "@/ui/DeniedState";
import { AsyncState } from "@/ui/AsyncState";
import { AVATARS, initials } from "@/ui/avatar";
import { useToast, EmptyState, Input, PageHeader, Select } from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
const STATUSES: AttendanceStatus[] = ["present", "absent", "excused"];
type SectionOpt = { sectionId: string; name: string; className: string };
type Student = {
  id: string; fullName: string; admissionNo: string; status: string;
  phone: string | null; guardianName: string | null; guardianPhone: string | null; dob: string | null;
};

export default function AttendancePage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [sections, setSections] = useState<SectionOpt[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [heldOn, setHeldOn] = useState(today);
  const [subjectId, setSubjectId] = useState("");
  const [slot, setSlot] = useState("day");
  const [roster, setRoster] = useState<Student[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [att, setAtt] = useState<Map<string, RosterCard>>(new Map());
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [info, setInfo] = useState<DrawerStudent | null>(null);
  const save = useMutation(api.recordAttendance);
  const toast = useToast();

  useEffect(() => {
    api.dashboard(year).then((dash) => {
      const opts: SectionOpt[] = [];
      for (const tile of dash.tiles) {
        if (tile.type === "class" || tile.type === "teacher-class") {
          const className = dash.names[tile.classId] ?? tile.classId;
          for (const s of tile.strip) opts.push({ sectionId: s.sectionId, name: s.name, className });
        }
      }
      setSections(opts);
      const params = new URLSearchParams(window.location.search);
      const wanted = params.get("sectionId");
      const wantedDate = params.get("date");
      if (wanted !== null && opts.some((o) => o.sectionId === wanted)) setSectionId(wanted);
      else if (opts[0]) setSectionId(opts[0].sectionId);
      if (wantedDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(wantedDate)) setHeldOn(wantedDate);
      const wantedSubject = params.get("subjectId");
      const wantedSlot = params.get("slot");
      if (wantedSubject !== null) setSubjectId(wantedSubject);
      if (wantedSlot !== null && wantedSlot.trim() !== "") setSlot(wantedSlot);
    }).catch(() => setSections([]));
  }, [year]);

  const loadRoster = useCallback(() => {
    if (!sectionId) return;
    setRoster(null);
    setRosterError(false);
    api.sectionRoster(sectionId).then((r) => {
      setRoster(r.students);
      setMarks(Object.fromEntries(r.students.map((s) => [s.id, "present" as AttendanceStatus])));
    }).catch(() => {
      setRoster(null);
      setRosterError(true);
    });
    // attendance % per student enriches the cards + the info drawer
    api.rosterAttendance(sectionId, { academicYear: year, ...(subjectId ? { subjectId } : {}) })
      .then((r) => setAtt(new Map(r.cards.map((c) => [c.studentId, c]))))
      .catch(() => setAtt(new Map()));
  }, [sectionId, year, subjectId]);
  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  async function submit() {
    const saved = await save.run({
      sectionId, heldOn, slot, academicYear: year,
      ...(subjectId !== "" ? { subjectId } : {}),
      entries: (roster ?? []).map((s) => ({ studentId: s.id, status: marks[s.id] ?? "present" })),
    });
    if (saved) toast.push({ status: "good", message: "Attendance saved — recompute analytics to see it on the dashboard." });
  }

  function openInfo(s: Student, idx: number) {
    const a = att.get(s.id);
    setInfo({
      studentId: s.id,
      initials: initials(s.fullName),
      gradient: AVATARS[idx % AVATARS.length]!,
      rollNo: s.admissionNo,
      name: s.fullName,
      section: sections.find((x) => x.sectionId === sectionId)
        ? `${sections.find((x) => x.sectionId === sectionId)!.className} · ${sections.find((x) => x.sectionId === sectionId)!.name}`
        : "",
      status: s.status,
      pct: a?.pct ?? null,
      attended: a?.attended ?? 0,
      total: a?.total ?? 0,
      lastMark: null,
      backlogs: s.status === "backlog" ? 1 : 0,
      flags: { short: (a?.pct ?? 100) < 75, backlog: s.status === "backlog", yb: s.status === "year_back" },
      phone: s.phone,
      guardianName: s.guardianName,
      guardianPhone: s.guardianPhone,
      dob: s.dob,
    });
  }

  const rosterList = roster ?? [];
  const tally = (st: AttendanceStatus) => rosterList.filter((s) => (marks[s.id] ?? "present") === st).length;
  const presentN = tally("present");
  const absentN = tally("absent");
  const otherN = rosterList.length - presentN - absentN;

  return (
    <>
      <PageHeader eyebrow="Attendance" title="Record attendance" />
      <p className={styles.lede}>
        {subjectId !== ""
          ? `Marking your subject's period (${slot}). Tap a card to mark; tap the name to see the student.`
          : "Tap a card to mark present/absent; tap the student's name for their record. Subject teachers mark their own period; the class teacher any."}
      </p>

      {sections.length === 0 ? (
        <DeniedState title="No sections you can record for." message="Open a period from your Today card to mark its attendance." />
      ) : (
        <>
          <div className={styles.filterRow}>
            <div className={styles.sectionField}>
              <Select
                id="att-section"
                label="Section"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                options={sections.map((s) => ({ value: s.sectionId, label: `${s.className} · ${s.name}` }))}
              />
            </div>
            <Input id="att-date" label="Date" type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
          </div>

          <AsyncState
            loading={roster === null && !rosterError}
            error={rosterError}
            onRetry={loadRoster}
            isEmpty={roster !== null && roster.length === 0}
            empty={<EmptyState title="No students enrolled in this section." />}
          >
            <div className="att-head">
              <div className="att-counts">
                <span><b>{presentN}</b> present</span>
                <span className="a"><b>{absentN}</b> absent</span>
                {otherN > 0 ? <span><b>{otherN}</b> excused</span> : null}
              </div>
              <button
                type="button"
                className="att-allpresent"
                onClick={() => setMarks(Object.fromEntries(rosterList.map((s) => [s.id, "present" as AttendanceStatus])))}
              >
                All present
              </button>
            </div>

            <div className="att-cards">
              {rosterList.map((s, idx) => {
                const cur = marks[s.id] ?? "present";
                const pct = att.get(s.id)?.pct ?? null;
                return (
                  <div key={s.id} className="att-card" data-status={cur}>
                    <button type="button" className="att-card-head" onClick={() => openInfo(s, idx)} aria-label={`${s.fullName} — view record`}>
                      <span className="cw-photo" style={{ background: AVATARS[idx % AVATARS.length] }} aria-hidden="true">
                        {initials(s.fullName)}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="cw-card-name" style={{ display: "block" }}>{s.fullName}</span>
                        <span className="cw-card-id">{s.admissionNo} · view ›</span>
                      </span>
                      {pct !== null ? (
                        <span className="att-card-mini">
                          <span className={`cw-mini-v ${pct < 75 ? "low" : "ok"}`} style={{ fontSize: 14 }}>{pct}%</span>
                          <span className="cw-mini-k">ATTEND</span>
                        </span>
                      ) : null}
                    </button>
                    <div className="att-seg" role="group" aria-label={`Attendance for ${s.fullName}`}>
                      {STATUSES.map((st) => (
                        <button
                          key={st}
                          type="button"
                          data-on={cur === st ? st : undefined}
                          aria-pressed={cur === st}
                          aria-label={st}
                          title={st}
                          onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))}
                          style={{ textTransform: "capitalize" }}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="att-save">
              <button className="btn" type="button" disabled={save.phase.name === "saving"} onClick={submit}>
                {save.phase.name === "saving" ? "Saving…" : `Save · ${presentN}/${rosterList.length} present`}
              </button>
              {save.phase.name === "error" ? (
                <span className="formerror" role="alert" style={{ margin: 0 }}>{save.phase.message}</span>
              ) : null}
            </div>
          </AsyncState>
        </>
      )}

      <StudentSlideOver student={info} canManage={false} onClose={() => setInfo(null)} />
    </>
  );
}
