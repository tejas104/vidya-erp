"use client";
import { useEffect, useMemo, useState } from "react";
import { api, currentAcademicYear, type AttendanceStatus } from "@/ui/api";
import { useMutation } from "@/ui/useMutation";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";

export const dynamic = "force-dynamic";
const STATUSES: AttendanceStatus[] = ["present", "absent", "late", "excused"];
type SectionOpt = { sectionId: string; name: string; className: string };
type Student = { id: string; fullName: string; admissionNo: string };

export default function AttendancePage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [sections, setSections] = useState<SectionOpt[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [heldOn, setHeldOn] = useState(today);
  // A subject teacher marks their own period (subjectId + slot arrive from
  // the Today card); a class teacher marking a whole-section day leaves both empty.
  const [subjectId, setSubjectId] = useState("");
  const [slot, setSlot] = useState("day");
  const [roster, setRoster] = useState<Student[]>([]);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const save = useMutation(api.recordAttendance);
  const toast = useToast();

  // Populate the section picker from the caller's class/teacher tiles.
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
      // --- timetable hand-off: ?sectionId=...&date=... preselects ---
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

  // Load the roster when a section is chosen.
  useEffect(() => {
    if (!sectionId) return;
    api.sectionRoster(sectionId).then((r) => {
      setRoster(r.students);
      setMarks(Object.fromEntries(r.students.map((s) => [s.id, "present" as AttendanceStatus])));
    }).catch(() => setRoster([]));
  }, [sectionId]);

  async function submit() {
    const saved = await save.run({
      sectionId, heldOn, slot, academicYear: year,
      ...(subjectId !== "" ? { subjectId } : {}),
      entries: roster.map((s) => ({ studentId: s.id, status: marks[s.id] ?? "present" })),
    });
    if (saved) toast.show("Attendance saved — recompute analytics to see it on the dashboard.", "good");
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
            ? `Marking your subject's period (${slot}). Only that subject's teacher — or the class teacher — can save it.`
            : "Mark the roster for a section and date. Subject teachers mark their own period; the class teacher can mark or correct any."
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
                  {otherN > 0 ? <span><b>{otherN}</b> late/excused</span> : null}
                </div>
                <button
                  type="button"
                  className="att-allpresent"
                  onClick={() => setMarks(Object.fromEntries(roster.map((s) => [s.id, "present" as AttendanceStatus])))}
                >
                  All present
                </button>
              </div>

              <div className="att-list">
                {roster.map((s) => {
                  const cur = marks[s.id] ?? "present";
                  return (
                    <div key={s.id} className="att-row">
                      <div className="att-id">
                        <div className="att-name">{s.fullName}</div>
                        <div className="att-roll">{s.admissionNo}</div>
                      </div>
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
                          >
                            {st[0]!.toUpperCase()}
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
    </>
  );
}
