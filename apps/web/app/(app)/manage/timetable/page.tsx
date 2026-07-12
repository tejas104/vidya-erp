"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type OrgTree,
  type TtEntry,
  type TtPeriod,
} from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type SectionOpt = { sectionId: string; label: string; classId: string; departmentId: string };

function sectionOptions(tree: OrgTree): SectionOpt[] {
  const options: SectionOpt[] = [];
  for (const dept of tree.departments) {
    for (const klass of dept.classes) {
      for (const section of klass.sections) {
        options.push({
          sectionId: section.id,
          label: `${klass.name} · Sec ${section.name}`,
          classId: klass.id,
          departmentId: dept.id,
        });
      }
    }
  }
  return options;
}

export default function TimetablePage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [periods, setPeriods] = useState<TtPeriod[]>([]);
  const [editingPeriods, setEditingPeriods] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [entries, setEntries] = useState<TtEntry[] | null>(null);
  const [saving, setSaving] = useState(false);
  // cell modal
  const [slot, setSlot] = useState<{ day: number; periodNo: number } | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [room, setRoom] = useState("");
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);
  const [doomed, setDoomed] = useState<TtEntry | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { colleges } = await api.colleges();
        const college = colleges[0];
        if (!college) {
          setFailed(true);
          return;
        }
        const [loadedTree, loadedPeriods] = await Promise.all([
          api.collegeTree(college.id),
          api.ttPeriodsGet(college.id),
        ]);
        setTree(loadedTree);
        setPeriods(loadedPeriods.periods);
        const first = sectionOptions(loadedTree)[0];
        if (first) setSectionId(first.sectionId);
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const loadGrid = useCallback(async () => {
    if (!sectionId) return;
    try {
      const grid = await api.ttSectionGrid(sectionId, year);
      setEntries(grid.entries);
      if (grid.periods.length > 0) setPeriods(grid.periods);
    } catch {
      setEntries([]);
    }
  }, [sectionId, year]);
  useEffect(() => {
    void loadGrid();
  }, [loadGrid]);

  const section = tree ? sectionOptions(tree).find((option) => option.sectionId === sectionId) : undefined;

  // teacher picker = teachers assigned to the section's class
  useEffect(() => {
    (async () => {
      if (!section) return;
      try {
        const { assignments } = await api.classTeacherAssignments(section.classId);
        const ids = [...new Set(assignments.map((a) => a.teacherId))];
        const resolved = await Promise.all(
          ids.map(async (id) => {
            try {
              const teacher = await api.getTeacher(id);
              return { id, name: teacher.fullName };
            } catch {
              return { id, name: id };
            }
          }),
        );
        setTeachers(resolved);
      } catch {
        setTeachers([]);
      }
    })();
  }, [section]);

  async function savePeriods() {
    if (!tree) return;
    setSaving(true);
    try {
      await api.ttPeriodsSet(tree.college.id, periods);
      toast.show("Period template saved.", "good");
      setEditingPeriods(false);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't save the template.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function createEntry() {
    if (!slot || subjectId === "" || teacherId === "") return;
    setSaving(true);
    try {
      await api.ttEntryCreate({
        sectionId,
        subjectId,
        teacherId,
        room,
        dayOfWeek: slot.day,
        periodNo: slot.periodNo,
        academicYear: year,
      });
      toast.show("Scheduled.", "good");
      setSlot(null);
      await loadGrid();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't schedule.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry() {
    if (!doomed) return;
    try {
      await api.ttEntryDelete(doomed.id);
      toast.show("Unscheduled.", "good");
      setDoomed(null);
      await loadGrid();
    } catch (caught) {
      setDoomed(null);
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't remove.", "danger");
    }
  }

  if (failed) return <EmptyState title="Couldn't load the timetable." message="Try again shortly." />;
  if (tree === null) return <Skeleton lines={5} />;

  const options = sectionOptions(tree);
  const subjects = tree.departments.find((dept) => dept.id === section?.departmentId)?.subjects ?? [];
  const cell = (day: number, periodNo: number) =>
    (entries ?? []).find((entry) => entry.dayOfWeek === day && entry.periodNo === periodNo);

  return (
    <>
      <PageHeader
        eyebrow="Timetable"
        title="Weekly timetable"
        lede="A fixed period grid per section. The database refuses double-bookings — a busy teacher, section or room answers with a clear message."
        actions={<Button variant="ghost" onClick={() => setEditingPeriods(true)}>Edit periods</Button>}
      />

      {periods.length === 0 ? (
        <EmptyState
          title="No period template yet."
          message="Define the college's periods first — e.g. P1 09:00–09:50 …"
          action={<Button onClick={() => setEditingPeriods(true)}>Define periods</Button>}
        />
      ) : options.length === 0 ? (
        <EmptyState title="No sections yet." message="Create classes and sections in Organisation first." />
      ) : (
        <>
          <Field label="Section" htmlFor="tt-section">
            <select id="tt-section" value={sectionId} onChange={(event) => setSectionId(event.target.value)} style={{ maxWidth: 340 }}>
              {options.map((option) => (
                <option key={option.sectionId} value={option.sectionId}>{option.label}</option>
              ))}
            </select>
          </Field>

          <div className="ui-tablewrap" style={{ marginTop: "var(--space-4)" }}>
            <table className="ui-table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  {DAYS.map((day) => (
                    <th key={day} scope="col">{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.periodNo}>
                    <td>
                      <strong>P{period.periodNo}</strong>{" "}
                      <span className="num" style={{ opacity: 0.6, fontSize: 12 }}>
                        {period.starts}–{period.ends}
                      </span>
                    </td>
                    {DAYS.map((_, index) => {
                      const day = index + 1;
                      const entry = cell(day, period.periodNo);
                      return (
                        <td key={day}>
                          {entry ? (
                            <button
                              type="button"
                              onClick={() => setDoomed(entry)}
                              title="Click to unschedule"
                              style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "var(--good-soft)", borderRadius: "var(--radius-sm)", padding: "6px 8px", cursor: "pointer", font: "inherit", fontSize: 12.5 }}
                            >
                              <strong>{entry.subjectName}</strong>
                              <br />
                              <span style={{ opacity: 0.75 }}>{entry.teacherName}</span>
                              {entry.room !== "" ? <span className="num" style={{ opacity: 0.6 }}> · {entry.room}</span> : null}
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Schedule ${DAYS[index]} period ${period.periodNo}`}
                              onClick={() => { setSubjectId(""); setTeacherId(""); setRoom(""); setSlot({ day, periodNo: period.periodNo }); }}
                              style={{ width: "100%", border: "1px dashed var(--rule-strong)", background: "transparent", color: "var(--ink-3)", borderRadius: "var(--radius-sm)", padding: "10px 0", cursor: "pointer", font: "inherit" }}
                            >
                              +
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* PERIOD TEMPLATE EDITOR */}
      <Modal
        open={editingPeriods}
        onClose={() => setEditingPeriods(false)}
        title="Period template"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingPeriods(false)}>Cancel</Button>
            <Button onClick={() => void savePeriods()} loading={saving}>Save template</Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          {periods.map((period, index) => (
            <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="num" style={{ width: 32 }}>P{period.periodNo}</span>
              <input
                aria-label={`period ${period.periodNo} starts`}
                value={period.starts}
                onChange={(event) => setPeriods((current) => current.map((p, i) => (i === index ? { ...p, starts: event.target.value } : p)))}
                style={{ width: 90 }}
              />
              <span>–</span>
              <input
                aria-label={`period ${period.periodNo} ends`}
                value={period.ends}
                onChange={(event) => setPeriods((current) => current.map((p, i) => (i === index ? { ...p, ends: event.target.value } : p)))}
                style={{ width: 90 }}
              />
              <Button variant="ghost" onClick={() => setPeriods((current) => current.filter((_, i) => i !== index).map((p, i) => ({ ...p, periodNo: i + 1 })))}>
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            onClick={() => setPeriods((current) => [...current, { periodNo: current.length + 1, starts: "09:00", ends: "09:50" }])}
          >
            Add period
          </Button>
          <p className="field-hint">Times are wall-clock, e.g. 09:00. Saving replaces the whole template.</p>
        </div>
      </Modal>

      {/* CELL SCHEDULER */}
      <Modal
        open={slot !== null}
        onClose={() => setSlot(null)}
        title={slot ? `${DAYS[slot.day - 1]} · P${slot.periodNo} — ${section?.label ?? ""}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSlot(null)}>Cancel</Button>
            <Button onClick={() => void createEntry()} loading={saving} disabled={subjectId === "" || teacherId === ""}>
              Schedule
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Subject" htmlFor="tt-subject">
            <select id="tt-subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
              <option value="">Choose…</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Teacher" htmlFor="tt-teacher" hint="Teachers assigned to this class.">
            <select id="tt-teacher" value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
              <option value="">Choose…</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Room (optional)" htmlFor="tt-room">
            <input id="tt-room" value={room} onChange={(event) => setRoom(event.target.value)} placeholder="204" />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={doomed !== null}
        title="Unschedule period"
        message={doomed ? `Remove ${doomed.subjectName} (${doomed.teacherName}) from ${DAYS[doomed.dayOfWeek - 1]} P${doomed.periodNo}?` : ""}
        confirmLabel="Remove"
        danger
        onConfirm={() => void removeEntry()}
        onCancel={() => setDoomed(null)}
      />
    </>
  );
}
