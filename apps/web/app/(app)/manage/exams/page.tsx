"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type ExamSeriesView,
  type ExamSlotView,
  type OrgTree,
} from "@/ui/api";
import { AsyncState } from "@/ui/AsyncState";
import {
  useToast,
  Button,
  Input,
  Select,
  Modal,
  StatusBadge,
  Card,
  Table,
  EmptyState,
  Skeleton,
  PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Row = { date: ReactNode; time: ReactNode; paper: ReactNode; series: ReactNode; room: ReactNode; actions: ReactNode };

export default function ExamsPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [tree, setTree] = useState<OrgTree | null | "error">(null);
  const [series, setSeries] = useState<ExamSeriesView[]>([]);
  const [selectedSeries, setSelectedSeries] = useState("");
  const [classId, setClassId] = useState("");
  const [slots, setSlots] = useState<ExamSlotView[] | null>(null);
  /** slotId → advisory clash string from creation time. */
  const [clashes, setClashes] = useState<Record<string, string>>({});
  // series modal
  const [creatingSeries, setCreatingSeries] = useState(false);
  const [seriesName, setSeriesName] = useState("");
  const [seriesTerm, setSeriesTerm] = useState("Term 1");
  const [savingSeries, setSavingSeries] = useState(false);
  const [doomedSeries, setDoomedSeries] = useState<ExamSeriesView | null>(null);
  // inline slot row
  const [subjectId, setSubjectId] = useState("");
  const [onDate, setOnDate] = useState("");
  const [starts, setStarts] = useState("09:00");
  const [ends, setEnds] = useState("12:00");
  const [room, setRoom] = useState("");
  const [addingSlot, setAddingSlot] = useState(false);

  const collegeId = tree !== null && tree !== "error" ? tree.college.id : null;
  const classes = tree !== null && tree !== "error" ? tree.departments.flatMap((dep) => dep.classes) : [];
  const subjects =
    tree !== null && tree !== "error"
      ? (tree.departments.find((dep) => dep.classes.some((cls) => cls.id === classId))?.subjects ?? [])
      : [];

  useEffect(() => {
    api.colleges()
      .then(async ({ colleges }) => {
        const college = colleges[0];
        if (!college) { setTree("error"); return; }
        const [orgTree, seriesList] = await Promise.all([
          api.collegeTree(college.id),
          api.exmSeries(college.id, year).catch(() => ({ series: [] as ExamSeriesView[] })),
        ]);
        setTree(orgTree);
        setSeries(seriesList.series);
      })
      .catch(() => setTree("error"));
  }, [year]);

  async function loadSlots(nextClassId: string) {
    setClassId(nextClassId);
    setSlots(null);
    if (nextClassId === "") return;
    try {
      const { slots: rows } = await api.exmClassSchedule(nextClassId, year);
      setSlots(rows);
    } catch (caught) {
      setSlots([]);
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't load the schedule." });
    }
  }

  async function createSeries() {
    if (collegeId === null || seriesName.trim() === "") return;
    setSavingSeries(true);
    try {
      const created = await api.exmCreateSeries({ collegeId, name: seriesName, academicYear: year, term: seriesTerm });
      setSeries((rows) => [...rows, created]);
      setSelectedSeries(created.id);
      setCreatingSeries(false);
      setSeriesName("");
      toast.push({ status: "good", message: `Series "${created.name}" created.` });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't create the series." });
    } finally {
      setSavingSeries(false);
    }
  }

  async function removeSeries() {
    if (!doomedSeries) return;
    try {
      await api.exmDeleteSeries(doomedSeries.id);
      setSeries((rows) => rows.filter((row) => row.id !== doomedSeries.id));
      if (selectedSeries === doomedSeries.id) setSelectedSeries("");
      setSlots((rows) => rows === null ? null : rows.filter((row) => row.seriesId !== doomedSeries.id));
      toast.push({ status: "good", message: "Series deleted." });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't delete." });
    } finally {
      setDoomedSeries(null);
    }
  }

  async function addSlot() {
    if (selectedSeries === "" || classId === "" || subjectId === "" || onDate === "") return;
    setAddingSlot(true);
    try {
      const created = await api.exmCreateSlot({
        seriesId: selectedSeries, classId, subjectId, onDate, starts, ends,
        ...(room.trim() !== "" ? { room: room.trim() } : {}),
      });
      const { clash, ...slot } = created;
      setSlots((rows) => [...(rows ?? []), slot]);
      if (clash !== undefined) setClashes((map) => ({ ...map, [slot.id]: clash }));
      setSubjectId("");
      toast.push({ status: clash !== undefined ? "info" : "good", message: clash !== undefined ? "Scheduled — with a room clash warning." : "Paper scheduled." });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't schedule." });
    } finally {
      setAddingSlot(false);
    }
  }

  async function removeSlot(slot: ExamSlotView) {
    try {
      await api.exmDeleteSlot(slot.id);
      setSlots((rows) => rows === null ? null : rows.filter((row) => row.id !== slot.id));
      toast.push({ status: "good", message: "Paper removed." });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't remove." });
    }
  }

  if (tree === null) return <Skeleton height={16} />;
  if (tree === "error") return <EmptyState title="Couldn't load the organisation." body="Try again shortly." />;

  const visibleSlots = (slots ?? [])
    .filter((slot) => selectedSeries === "" || slot.seriesId === selectedSeries)
    .sort((a, b) => a.onDate.localeCompare(b.onDate) || a.starts.localeCompare(b.starts));

  const columns: TableColumn<Row>[] = [
    { key: "date", header: "Date", figure: true },
    { key: "time", header: "Time", figure: true },
    { key: "paper", header: "Paper" },
    { key: "series", header: "Series" },
    { key: "room", header: "Room" },
    { key: "actions", header: "" },
  ];
  const rows: Row[] = visibleSlots.map((slot) => ({
    date: slot.onDate,
    time: `${slot.starts}–${slot.ends}`,
    paper: <strong>{slot.subjectName}</strong>,
    series: slot.seriesName,
    room: (
      <>
        {slot.room === "" ? "—" : slot.room}{" "}
        {clashes[slot.id] !== undefined ? <StatusBadge status="warn">{clashes[slot.id]}</StatusBadge> : null}
      </>
    ),
    actions: <Button variant="ghost" onClick={() => void removeSlot(slot)}>Remove</Button>,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Exams"
        title="The exam timetable"
        actions={<Button onClick={() => setCreatingSeries(true)}>New series</Button>}
      />
      <p className={styles.lede}>
        Create a series, then schedule each paper — date, time, room. Room clashes with lessons warn but never block.
      </p>

      <section className="section" aria-label="Exam series">
        <div className="section-head"><h2>Series · {year}</h2></div>
        {series.length === 0 ? (
          <EmptyState title="No exam series yet." body="Create one — every paper hangs off a series." />
        ) : (
          <Card>
            {series.map((row) => (
              <div key={row.id} className={styles.seriesRow}>
                <label className={styles.seriesLabel}>
                  <input
                    type="radio"
                    name="exm-series"
                    checked={selectedSeries === row.id}
                    onChange={() => setSelectedSeries(row.id)}
                    aria-label={`Select ${row.name}`}
                  />
                  <strong>{row.name}</strong>
                  <StatusBadge status="neutral">{row.term}</StatusBadge>
                  <span className={`num ${styles.seriesCount}`}>{row.slotCount} papers</span>
                </label>
                <Button variant="danger" onClick={() => setDoomedSeries(row)}>Delete</Button>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="section" aria-label="Slot editor">
        <div className="section-head"><h2>Papers</h2></div>
        <Card>
          <Select
            id="exm-class"
            label="Class"
            value={classId}
            onChange={(event) => void loadSlots(event.target.value)}
            options={[{ value: "", label: "Pick a class…" }, ...classes.map((cls) => ({ value: cls.id, label: cls.name }))]}
          />

          {classId !== "" ? (
            <AsyncState loading={slots === null} error={false} isEmpty={visibleSlots.length === 0} empty={<EmptyState title="No exams scheduled." body="Add the first paper below." />}>
              <div className={styles.tableWrap}>
                <Table columns={columns} rows={rows} />
              </div>
            </AsyncState>
          ) : null}

          {classId !== "" && slots !== null ? (
            selectedSeries === "" ? (
              <p className={styles.hint}>Select a series above to add papers.</p>
            ) : (
              <div className={styles.slotForm}>
                <Select
                  id="exm-subject"
                  label="Subject"
                  value={subjectId}
                  onChange={(event) => setSubjectId(event.target.value)}
                  options={[{ value: "", label: "Subject…" }, ...subjects.map((subject) => ({ value: subject.id, label: subject.name }))]}
                />
                <Input id="exm-date" label="Date" type="date" value={onDate} onChange={(event) => setOnDate(event.target.value)} />
                <Input id="exm-starts" label="Starts" type="time" value={starts} onChange={(event) => setStarts(event.target.value)} className={styles.narrow} />
                <Input id="exm-ends" label="Ends" type="time" value={ends} onChange={(event) => setEnds(event.target.value)} className={styles.narrow} />
                <Input id="exm-room" label="Room" value={room} onChange={(event) => setRoom(event.target.value)} className={styles.narrow} />
                <Button onClick={() => void addSlot()} loading={addingSlot} disabled={subjectId === "" || onDate === ""}>
                  Add paper
                </Button>
              </div>
            )
          ) : null}
        </Card>
      </section>

      <Modal
        open={creatingSeries}
        onClose={() => setCreatingSeries(false)}
        title="New exam series"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreatingSeries(false)}>Cancel</Button>
            <Button onClick={() => void createSeries()} loading={savingSeries} disabled={seriesName.trim() === ""}>
              Create series
            </Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <Input id="exm-series-name" label="Name" value={seriesName} onChange={(event) => setSeriesName(event.target.value)} placeholder="Midterm" />
          <Input id="exm-series-term" label="Term" value={seriesTerm} onChange={(event) => setSeriesTerm(event.target.value)} />
        </div>
      </Modal>

      <Modal
        open={doomedSeries !== null}
        onClose={() => setDoomedSeries(null)}
        title="Delete exam series"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDoomedSeries(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void removeSeries()}>Delete</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>
          Delete &quot;{doomedSeries?.name ?? ""}&quot; and every paper in it? Students stop seeing the schedule immediately.
        </p>
      </Modal>
    </>
  );
}
