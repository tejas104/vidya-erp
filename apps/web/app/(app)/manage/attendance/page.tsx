"use client";
import { useEffect, useMemo, useState } from "react";
import { api, currentAcademicYear, type AttendanceStatus, type RosterCard } from "@/ui/api";
import { useMutation } from "@/ui/useMutation";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { StudentDrawer, type DrawerStudent } from "@/ui/StudentDrawer";

export const dynamic = "force-dynamic";
const STATUSES: AttendanceStatus[] = ["present", "absent", "excused"];
const AVATARS = [
  "linear-gradient(140deg,#6B7BFF,#4A5BD8)",
  "linear-gradient(140deg,#F59E0B,#D97706)",
  "linear-gradient(140deg,#10B981,#059669)",
  "linear-gradient(140deg,#8B5CF6,#7C3AED)",
  "linear-gradient(140deg,#EC4899,#DB2777)",
  "linear-gradient(140deg,#06B6D4,#0891B2)",
];
const initials = (n: string) => {
  const p = n.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] : "")).toUpperCase() || "·";
};
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
  const [roster, setRoster] = useState<Student[]>([]);
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

  useEffect(() => {
    if (!sectionId) return;
    api.sectionRoster(sectionId).then((r) => {
      setRoster(r.students);
      setMarks(Object.fromEntries(r.students.map((s) => [s.id, "present" as AttendanceStatus])));
    }).catch(() => setRoster([]));
    // attendance % per student enriches the cards + the info drawer
    api.rosterAttendance(sectionId, { academicYear: year, ...(subjectId ? { subjectId } : {}) })
      .then((r) => setAtt(new Map(r.cards.map((c) => [c.studentId, c]))))
      .catch(() => setAtt(new Map()));
  }, [sectionId, year, subjectId]);

  async function submit() {
    const saved = await save.run({
      sectionId, heldOn, slot, academicYear: year,
      ...(subjectId !== "" ? { subjectId } : {}),
      entries: roster.map((s) => ({ studentId: s.id, status: marks[s.id] ?? "present" })),
    });
    if (saved) toast.show("Attendance saved — recompute analytics to see it on the dashboard.", "good");
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

  const tally = (st: AttendanceStatus) => roster.filter((s) => (marks[s.id] ?? "present") === st).length;
  const presentN = tally("present");
  const absentN = tally("absent");
  const otherN = roster.length - presentN - absentN;

  return (
    <>
      <PageHeader
        eyebrow="Attendance"
        title="Record attendance"
        lede={
          subjectId !== ""
            ? `Marking your subject's period (${slot}). Tap a card to mark; tap the name to see the student.`
            : "Tap a card to mark present/absent; tap the student's name for their record. Subject teachers mark their own period; the class teacher any."
        }
      />

      {sections.length === 0 ? (
        <div className="state"><strong>No sections you can record for.</strong> Open a period from your Today card to mark its attendance.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
            <label className="field" style={{ minWidth: 220 }}>
              <span>Section</span>
              <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                {sections.map((s) => (<option key={s.sectionId} value={s.sectionId}>{s.className} · {s.name}</option>))}
              </select>
            </label>
            <label className="field">
              <span>Date</span>
              <input type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
            </label>
          </div>

          {roster.length === 0 ? (
            <div className="strip-empty">No students enrolled in this section.</div>
          ) : (
            <>
              <div className="att-head">
                <div className="att-counts">
                  <span><b>{presentN}</b> present</span>
                  <span className="a"><b>{absentN}</b> absent</span>
                  {otherN > 0 ? <span><b>{otherN}</b> excused</span> : null}
                </div>
                <button
                  type="button"
                  className="att-allpresent"
                  onClick={() => setMarks(Object.fromEntries(roster.map((s) => [s.id, "present" as AttendanceStatus])))}
                >
                  All present
                </button>
              </div>

              <div className="att-cards">
                {roster.map((s, idx) => {
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
                  {save.phase.name === "saving" ? "Saving…" : `Save · ${presentN}/${roster.length} present`}
                </button>
                {save.phase.name === "error" ? (
                  <span className="formerror" role="alert" style={{ margin: 0 }}>{save.phase.message}</span>
                ) : null}
              </div>
            </>
          )}
        </>
      )}

      <StudentDrawer student={info} canManage={false} onClose={() => setInfo(null)} />
    </>
  );
}
