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
      if (opts[0]) setSectionId(opts[0].sectionId);
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
      sectionId, heldOn, slot: "day", academicYear: year,
      entries: roster.map((s) => ({ studentId: s.id, status: marks[s.id] ?? "present" })),
    });
    if (saved) toast.show("Attendance saved — recompute analytics to see it on the dashboard.", "good");
  }

  return (
    <>
      <PageHeader
        eyebrow="Attendance"
        title="Record attendance"
        lede="Mark the roster for a section and date. You can only record for a class you teach."
      />

      {sections.length === 0 ? (
        <div className="state"><strong>No sections you can record for.</strong> Attendance is recorded by a class teacher.</div>
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

          <div className="card">
            {roster.length === 0 ? <div className="strip-empty">No students enrolled in this section.</div> : roster.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                <span><strong>{s.fullName}</strong> <span className="num" style={{ opacity: 0.6 }}>{s.admissionNo}</span></span>
                <span style={{ display: "flex", gap: 6 }}>
                  {STATUSES.map((st) => (
                    <button key={st} type="button"
                      className={`chip${marks[s.id] === st ? " serious" : ""}`}
                      style={{ cursor: "pointer", textTransform: "capitalize" }}
                      aria-pressed={marks[s.id] === st}
                      onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))}>{st}</button>
                  ))}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 20 }}>
            <button className="btn" type="button" disabled={save.phase.name === "saving" || roster.length === 0} onClick={submit}>
              {save.phase.name === "saving" ? "Saving…" : "Save attendance"}
            </button>
            {save.phase.name === "error" ? <span className="formerror" role="alert" style={{ margin: 0 }}>{save.phase.message}</span> : null}
          </div>
        </>
      )}
    </>
  );
}
