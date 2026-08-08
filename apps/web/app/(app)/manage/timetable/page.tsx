"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type OrgTree,
  type TtEntry,
  type TtPeriod,
} from "@/ui/api";
import {
  useToast,
  Button,
  Input,
  Select,
  Modal,
  Table,
  EmptyState,
  Skeleton,
  PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import { HelpButton } from "@/ui/help/HelpButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_KEYS = ["d1", "d2", "d3", "d4", "d5", "d6"] as const;
type DayKey = (typeof DAY_KEYS)[number];
type Row = { period: ReactNode } & Record<DayKey, ReactNode>;

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
  const sectionClassId = section?.classId;
  useEffect(() => {
    (async () => {
      if (sectionClassId === undefined) return;
      try {
        const { assignments } = await api.classTeacherAssignments(sectionClassId);
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
  }, [sectionClassId]);

  async function savePeriods() {
    if (!tree) return;
    setSaving(true);
    try {
      await api.ttPeriodsSet(tree.college.id, periods);
      toast.push({ status: "good", message: "Period template saved." });
      setEditingPeriods(false);
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't save the template." });
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
      toast.push({ status: "good", message: "Scheduled." });
      setSlot(null);
      await loadGrid();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't schedule." });
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry() {
    if (!doomed) return;
    try {
      await api.ttEntryDelete(doomed.id);
      toast.push({ status: "good", message: "Unscheduled." });
      setDoomed(null);
      await loadGrid();
    } catch (caught) {
      setDoomed(null);
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't remove." });
    }
  }

  if (failed) return <EmptyState title="Couldn't load the timetable." body="Try again shortly." />;
  if (tree === null) return <Skeleton height={16} />;

  const options = sectionOptions(tree);
  const subjects = tree.departments.find((dept) => dept.id === section?.departmentId)?.subjects ?? [];
  const cell = (day: number, periodNo: number) =>
    (entries ?? []).find((entry) => entry.dayOfWeek === day && entry.periodNo === periodNo);

  const columns: TableColumn<Row>[] = [
    { key: "period", header: "Period" },
    ...DAYS.map((day, index) => ({ key: DAY_KEYS[index]!, header: day })),
  ];
  const rows: Row[] = periods.map((period) => {
    const row = {
      period: (
        <>
          <strong>P{period.periodNo}</strong> <span className={`num ${styles.periodTime}`}>{period.starts}–{period.ends}</span>
        </>
      ),
    } as Row;
    DAY_KEYS.forEach((key, index) => {
      const day = index + 1;
      const entry = cell(day, period.periodNo);
      row[key] = entry ? (
        <button type="button" onClick={() => setDoomed(entry)} title="Click to unschedule" className={styles.entryBtn}>
          <strong>{entry.subjectName}</strong>
          <br />
          <span className={styles.entryMeta}>{entry.teacherName}</span>
          {entry.room !== "" ? <span className={`num ${styles.entryRoom}`}> · {entry.room}</span> : null}
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Schedule ${DAYS[index]} period ${period.periodNo}`}
          onClick={() => { setSubjectId(""); setTeacherId(""); setRoom(""); setSlot({ day, periodNo: period.periodNo }); }}
          className={styles.emptyBtn}
        >
          +
        </button>
      );
    });
    return row;
  });

  return (
    <>
      <PageHeader
        eyebrow="Timetable"
        title="Weekly timetable"
        lede="A fixed period grid per section. The database refuses double-bookings — a busy teacher, section or room answers with a clear message."
        actions={<Button variant="ghost" onClick={() => setEditingPeriods(true)}>Edit periods</Button>}
        help={<HelpButton slug="timetable" />}
      />

      {periods.length === 0 ? (
        <EmptyState
          title="No period template yet."
          body="Define the college's periods first — e.g. P1 09:00–09:50 …"
          action={{ label: "Define periods", onClick: () => setEditingPeriods(true) }}
        />
      ) : options.length === 0 ? (
        <EmptyState title="No sections yet." body="Create classes and sections in Organisation first." />
      ) : (
        <>
          <div className={styles.sectionPicker}>
            <Select
              id="tt-section"
              label="Section"
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              options={options.map((option) => ({ value: option.sectionId, label: option.label }))}
            />
          </div>

          <div className={styles.tableWrap}>
            <Table columns={columns} rows={rows} />
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
        <div className={styles.periodEditor}>
          {periods.map((period, index) => (
            <div key={index} className={styles.periodRow}>
              <span className={`num ${styles.periodNo}`}>P{period.periodNo}</span>
              <input
                aria-label={`period ${period.periodNo} starts`}
                value={period.starts}
                onChange={(event) => setPeriods((current) => current.map((p, i) => (i === index ? { ...p, starts: event.target.value } : p)))}
                className={styles.timeInput}
              />
              <span>–</span>
              <input
                aria-label={`period ${period.periodNo} ends`}
                value={period.ends}
                onChange={(event) => setPeriods((current) => current.map((p, i) => (i === index ? { ...p, ends: event.target.value } : p)))}
                className={styles.timeInput}
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
        <div className={styles.formGrid}>
          <Select
            id="tt-subject"
            label="Subject"
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            options={[{ value: "", label: "Choose…" }, ...subjects.map((subject) => ({ value: subject.id, label: subject.name }))]}
          />
          <Select
            id="tt-teacher"
            label="Teacher"
            hint="Teachers assigned to this class."
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
            options={[{ value: "", label: "Choose…" }, ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.name }))]}
          />
          <Input id="tt-room" label="Room (optional)" value={room} onChange={(event) => setRoom(event.target.value)} placeholder="204" />
        </div>
      </Modal>

      <Modal
        open={doomed !== null}
        onClose={() => setDoomed(null)}
        title="Unschedule period"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDoomed(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void removeEntry()}>Remove</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>
          {doomed ? `Remove ${doomed.subjectName} (${doomed.teacherName}) from ${DAYS[doomed.dayOfWeek - 1]} P${doomed.periodNo}?` : ""}
        </p>
      </Modal>
    </>
  );
}
