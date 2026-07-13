"use client";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type ExamSeriesView,
  type ExamSlotView,
  type OrgTree,
} from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Badge } from "@/ui/Badge";
import { Card } from "@/ui/Card";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

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
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't load the schedule.", "danger");
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
      toast.show(`Series "${created.name}" created.`, "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't create the series.", "danger");
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
      toast.show("Series deleted.", "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't delete.", "danger");
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
      toast.show(clash !== undefined ? "Scheduled — with a room clash warning." : "Paper scheduled.", clash !== undefined ? "info" : "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't schedule.", "danger");
    } finally {
      setAddingSlot(false);
    }
  }

  async function removeSlot(slot: ExamSlotView) {
    try {
      await api.exmDeleteSlot(slot.id);
      setSlots((rows) => rows === null ? null : rows.filter((row) => row.id !== slot.id));
      toast.show("Paper removed.", "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't remove.", "danger");
    }
  }

  if (tree === null) return <Skeleton lines={5} />;
  if (tree === "error") return <EmptyState title="Couldn't load the organisation." message="Try again shortly." />;

  const visibleSlots = (slots ?? [])
    .filter((slot) => selectedSeries === "" || slot.seriesId === selectedSeries)
    .sort((a, b) => a.onDate.localeCompare(b.onDate) || a.starts.localeCompare(b.starts));

  return (
    <>
      <PageHeader
        eyebrow="Exams"
        title="The exam timetable"
        lede="Create a series, then schedule each paper — date, time, room. Room clashes with lessons warn but never block."
        actions={<Button onClick={() => setCreatingSeries(true)}>New series</Button>}
      />

      <section className="section" aria-label="Exam series">
        <div className="section-head"><h2>Series · {year}</h2></div>
        {series.length === 0 ? (
          <EmptyState title="No exam series yet." message="Create one — every paper hangs off a series." />
        ) : (
          <Card>
            {series.map((row) => (
              <div key={row.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 0", borderTop: "1px solid var(--rule)" }}>
                <label style={{ display: "inline-flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="exm-series"
                    checked={selectedSeries === row.id}
                    onChange={() => setSelectedSeries(row.id)}
                    aria-label={`Select ${row.name}`}
                  />
                  <strong>{row.name}</strong>
                  <Badge>{row.term}</Badge>
                  <span className="num" style={{ fontSize: 12.5, opacity: 0.65 }}>{row.slotCount} papers</span>
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
          <Field label="Class" htmlFor="exm-class">
            <select id="exm-class" value={classId} onChange={(event) => void loadSlots(event.target.value)}>
              <option value="">Pick a class…</option>
              {classes.map((cls) => (<option key={cls.id} value={cls.id}>{cls.name}</option>))}
            </select>
          </Field>

          {classId !== "" && slots === null ? <Skeleton lines={3} /> : null}
          {classId !== "" && slots !== null ? (
            <>
              {visibleSlots.length === 0 ? (
                <EmptyState title="No exams scheduled." message="Add the first paper below." />
              ) : (
                <div className="ui-tablewrap" style={{ marginTop: "var(--space-3)" }}>
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th scope="col">Date</th><th scope="col">Time</th><th scope="col">Paper</th>
                        <th scope="col">Series</th><th scope="col">Room</th><th scope="col" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSlots.map((slot) => (
                        <tr key={slot.id}>
                          <td><span className="num">{slot.onDate}</span></td>
                          <td><span className="num">{slot.starts}–{slot.ends}</span></td>
                          <td><strong>{slot.subjectName}</strong></td>
                          <td>{slot.seriesName}</td>
                          <td>
                            {slot.room === "" ? "—" : slot.room}{" "}
                            {clashes[slot.id] !== undefined ? <Badge tone="warn">{clashes[slot.id]}</Badge> : null}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <Button variant="ghost" onClick={() => void removeSlot(slot)}>Remove</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedSeries === "" ? (
                <p style={{ fontSize: 13, opacity: 0.7 }}>Select a series above to add papers.</p>
              ) : (
                <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-end", marginTop: "var(--space-3)" }}>
                  <Field label="Subject" htmlFor="exm-subject">
                    <select id="exm-subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                      <option value="">Subject…</option>
                      {subjects.map((subject) => (<option key={subject.id} value={subject.id}>{subject.name}</option>))}
                    </select>
                  </Field>
                  <Field label="Date" htmlFor="exm-date">
                    <input id="exm-date" type="date" value={onDate} onChange={(event) => setOnDate(event.target.value)} />
                  </Field>
                  <Field label="Starts" htmlFor="exm-starts">
                    <input id="exm-starts" type="time" value={starts} onChange={(event) => setStarts(event.target.value)} style={{ width: 110 }} />
                  </Field>
                  <Field label="Ends" htmlFor="exm-ends">
                    <input id="exm-ends" type="time" value={ends} onChange={(event) => setEnds(event.target.value)} style={{ width: 110 }} />
                  </Field>
                  <Field label="Room" htmlFor="exm-room">
                    <input id="exm-room" value={room} onChange={(event) => setRoom(event.target.value)} style={{ width: 110 }} />
                  </Field>
                  <Button onClick={() => void addSlot()} loading={addingSlot} disabled={subjectId === "" || onDate === ""}>
                    Add paper
                  </Button>
                </div>
              )}
            </>
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
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Name" htmlFor="exm-series-name">
            <input id="exm-series-name" value={seriesName} onChange={(event) => setSeriesName(event.target.value)} placeholder="Midterm" />
          </Field>
          <Field label="Term" htmlFor="exm-series-term">
            <input id="exm-series-term" value={seriesTerm} onChange={(event) => setSeriesTerm(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={doomedSeries !== null}
        title="Delete exam series"
        message={`Delete "${doomedSeries?.name ?? ""}" and every paper in it? Students stop seeing the schedule immediately.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => void removeSeries()}
        onCancel={() => setDoomedSeries(null)}
      />
    </>
  );
}
