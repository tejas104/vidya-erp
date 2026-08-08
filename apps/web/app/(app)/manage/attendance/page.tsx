"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, currentAcademicYear, type AttendanceStatus } from "@/ui/api";
import { useMutation } from "@/ui/useMutation";
import { DeniedState } from "@/ui/DeniedState";
import { AsyncState } from "@/ui/AsyncState";
import { Icon } from "@/ui/Icon";
import { AVATARS, initials } from "@/ui/avatar";
import { useToast, Button, EmptyState, Input, PageHeader, Select, StatusBadge } from "@vidya/ui-system";
import { HelpButton } from "@/ui/help/HelpButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
type SectionOpt = { sectionId: string; name: string; className: string };
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
  const [sectionId, setSectionId] = useState("");
  const [heldOn, setHeldOn] = useState(today);
  const [subjectId, setSubjectId] = useState("");
  const [slot, setSlot] = useState("day");
  const [roster, setRoster] = useState<Student[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
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
  }, [sectionId]);
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

  const rosterList = roster ?? [];
  const tally = (st: AttendanceStatus) => rosterList.filter((s) => (marks[s.id] ?? "present") === st).length;
  const presentN = tally("present");
  const absentN = tally("absent");
  const lateN = tally("late");
  const excusedN = tally("excused");

  return (
    <>
      <PageHeader
        eyebrow="Attendance"
        title="Record attendance"
        lede={
          subjectId !== ""
            ? `Marking your subject's period (${slot}). Tap a student to mark absent.`
            : "Tap a student to mark absent — everyone starts present. Subject teachers mark their own period; the class teacher any."
        }
        help={<HelpButton slug="attendance" />}
      />

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
            <div className={styles.summary} aria-live="polite">
              <StatusBadge status="good">{presentN} present</StatusBadge>
              <StatusBadge status="danger" icon={<Icon name="close" size={12} />}>{absentN} absent</StatusBadge>
              {lateN > 0 ? <StatusBadge status="warn">{lateN} late</StatusBadge> : null}
              {excusedN > 0 ? <StatusBadge status="neutral">{excusedN} excused</StatusBadge> : null}
              <Button
                variant="secondary"
                size="sm"
                className={styles.allPresent}
                onClick={() => setMarks(Object.fromEntries(rosterList.map((s) => [s.id, "present" as AttendanceStatus])))}
              >
                All present
              </Button>
            </div>

            <div className={styles.grid} role="group" aria-label={`Attendance grid, ${rosterList.length} students`}>
              {rosterList.map((s, idx) => {
                const cur = marks[s.id] ?? "present";
                const av = AVATARS[idx % AVATARS.length]!;
                const pressed: boolean | "mixed" = cur === "present" ? false : cur === "absent" ? true : "mixed";
                return (
                  <div key={s.id} className={styles.cell}>
                    <button
                      type="button"
                      className={styles.cellBtn}
                      data-status={cur}
                      aria-pressed={pressed}
                      aria-label={`${s.fullName}, roll ${s.admissionNo} — ${cur}`}
                      onClick={() => setMarks((m) => ({ ...m, [s.id]: toggleAbsent(m[s.id] ?? "present") }))}
                    >
                      <span className={styles.avatar} style={{ background: av.gradient, color: av.ink }} aria-hidden="true">
                        {initials(s.fullName)}
                      </span>
                      <span className={styles.roll}>{s.admissionNo}</span>
                      <span className={styles.statusMark} aria-hidden="true">
                        {cur === "present" ? <Icon name="check" size={14} /> : null}
                        {cur === "absent" ? <Icon name="close" size={14} /> : null}
                        {cur === "late" ? "L" : null}
                        {cur === "excused" ? "E" : null}
                      </span>
                    </button>
                    <select
                      className={styles.secondary}
                      aria-label={`Mark ${s.fullName} late or excused`}
                      value={cur === "late" || cur === "excused" ? cur : ""}
                      onChange={(e) => setMarks((m) => ({ ...m, [s.id]: fromSecondary(e.target.value) }))}
                    >
                      <option value="">—</option>
                      <option value="late">Late</option>
                      <option value="excused">Excused</option>
                    </select>
                  </div>
                );
              })}
            </div>

            <div className={styles.saveBar}>
              <Button disabled={save.phase.name === "saving"} onClick={submit}>
                {save.phase.name === "saving" ? "Saving…" : "Save attendance"}
              </Button>
              {save.phase.name === "error" ? <span className="formerror" role="alert">{save.phase.message}</span> : null}
            </div>
          </AsyncState>
        </>
      )}
    </>
  );
}
