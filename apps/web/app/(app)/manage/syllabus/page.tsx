"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type OrgTree,
  type SyllabusView,
  type UnitView,
  type TopicView,
} from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";
import { RingStat } from "@/ui/RingStat";

export const dynamic = "force-dynamic";

type ClassOpt = { classId: string; label: string; subjects: { id: string; name: string }[] };

function classOptions(tree: OrgTree): ClassOpt[] {
  const options: ClassOpt[] = [];
  for (const dept of tree.departments) {
    for (const klass of dept.classes) {
      options.push({
        classId: klass.id,
        label: `${dept.code} · ${klass.name}`,
        subjects: dept.subjects.map((subject) => ({ id: subject.id, name: subject.name })),
      });
    }
  }
  return options;
}

function saveErrorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError && caught.status === 403) return "You don't teach this subject.";
  if (caught instanceof ApiError) return caught.message;
  return fallback;
}

export default function SyllabusPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [editableSet, setEditableSet] = useState<Set<string>>(new Set());
  const [syllabus, setSyllabus] = useState<SyllabusView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  // add unit
  const [newUnitTitle, setNewUnitTitle] = useState("");
  // rename unit
  const [renamingUnit, setRenamingUnit] = useState<UnitView | null>(null);
  const [renameUnitTitle, setRenameUnitTitle] = useState("");
  const [deletingUnit, setDeletingUnit] = useState<UnitView | null>(null);
  // topics
  const [newTopicTitle, setNewTopicTitle] = useState<Record<string, string>>({});
  const [renamingTopic, setRenamingTopic] = useState<TopicView | null>(null);
  const [renameTopicTitle, setRenameTopicTitle] = useState("");
  const [deletingTopic, setDeletingTopic] = useState<TopicView | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { colleges } = await api.colleges();
        const college = colleges[0];
        if (!college) {
          setFailed(true);
          return;
        }
        const loaded = await api.collegeTree(college.id);
        setTree(loaded);
        const first = classOptions(loaded)[0];
        if (first) {
          setClassId(first.classId);
          setSubjectId(first.subjects[0]?.id ?? "");
        }
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  useEffect(() => {
    api
      .dashboard(year)
      .then((dash) => {
        const set = new Set<string>();
        for (const tile of dash.tiles) {
          if (tile.type === "teacher-class") set.add(`${tile.classId}:${tile.subjectId}`);
        }
        setEditableSet(set);
      })
      .catch(() => setEditableSet(new Set()));
  }, [year]);

  const load = useCallback(async () => {
    if (!classId) return;
    setLoadError(false);
    try {
      setSyllabus(await api.syllabusForClass(classId, year));
    } catch {
      setSyllabus(null);
      setLoadError(true);
    }
  }, [classId, year]);
  useEffect(() => {
    void load();
  }, [load]);

  async function addUnit() {
    if (newUnitTitle.trim() === "") return;
    setSaving(true);
    try {
      await api.createUnit({ classId, subjectId, academicYear: year, title: newUnitTitle });
      toast.show(`Unit "${newUnitTitle}" added.`, "good");
      setNewUnitTitle("");
      await load();
    } catch (caught) {
      toast.show(saveErrorMessage(caught, "Couldn't add the unit."), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitRenameUnit() {
    if (!renamingUnit || renameUnitTitle.trim() === "") return;
    setSaving(true);
    try {
      await api.updateUnit(renamingUnit.id, { title: renameUnitTitle });
      toast.show("Unit renamed.", "good");
      setRenamingUnit(null);
      await load();
    } catch (caught) {
      toast.show(saveErrorMessage(caught, "Couldn't rename the unit."), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteUnit() {
    if (!deletingUnit) return;
    try {
      await api.deleteUnit(deletingUnit.id);
      toast.show("Unit deleted.", "good");
      setDeletingUnit(null);
      await load();
    } catch (caught) {
      setDeletingUnit(null);
      toast.show(saveErrorMessage(caught, "Couldn't delete the unit."), "danger");
    }
  }

  async function addTopicTo(unit: UnitView) {
    const title = (newTopicTitle[unit.id] ?? "").trim();
    if (title === "") return;
    setSaving(true);
    try {
      await api.addTopic(unit.id, { title });
      toast.show(`Topic "${title}" added.`, "good");
      setNewTopicTitle((current) => ({ ...current, [unit.id]: "" }));
      await load();
    } catch (caught) {
      toast.show(saveErrorMessage(caught, "Couldn't add the topic."), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitRenameTopic() {
    if (!renamingTopic || renameTopicTitle.trim() === "") return;
    setSaving(true);
    try {
      await api.updateTopic(renamingTopic.id, { title: renameTopicTitle });
      toast.show("Topic renamed.", "good");
      setRenamingTopic(null);
      await load();
    } catch (caught) {
      toast.show(saveErrorMessage(caught, "Couldn't rename the topic."), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteTopic() {
    if (!deletingTopic) return;
    try {
      await api.deleteTopic(deletingTopic.id);
      toast.show("Topic deleted.", "good");
      setDeletingTopic(null);
      await load();
    } catch (caught) {
      setDeletingTopic(null);
      toast.show(saveErrorMessage(caught, "Couldn't delete the topic."), "danger");
    }
  }

  async function markTaught(topic: TopicView, value: string) {
    setSaving(true);
    try {
      await api.setTopicCoverage(topic.id, value === "" ? null : value);
      await load();
    } catch (caught) {
      toast.show(saveErrorMessage(caught, "Couldn't update coverage."), "danger");
    } finally {
      setSaving(false);
    }
  }

  if (failed) return <EmptyState title="Couldn't load the college." message="Try again shortly." />;
  if (tree === null) return <Skeleton lines={5} />;

  const classes = classOptions(tree);
  const subjects = classes.find((option) => option.classId === classId)?.subjects ?? [];
  const editable = editableSet.has(`${classId}:${subjectId}`);
  const loading = syllabus === null && !loadError;
  const units = (syllabus?.units ?? [])
    .filter((unit) => unit.subjectId === subjectId)
    .slice()
    .sort((a, b) => a.position - b.position);

  return (
    <>
      <PageHeader
        eyebrow="Syllabus"
        title="Syllabus & coverage"
        lede="Units and topics for a class · subject, with per-topic taught dates rolling up to a coverage percentage."
      />

      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="Class" htmlFor="syl-class">
          <select
            id="syl-class"
            value={classId}
            onChange={(event) => {
              setClassId(event.target.value);
              const nextSubjects = classes.find((option) => option.classId === event.target.value)?.subjects ?? [];
              setSubjectId(nextSubjects[0]?.id ?? "");
            }}
            style={{ maxWidth: 280 }}
          >
            {classes.map((option) => (
              <option key={option.classId} value={option.classId}>{option.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Subject" htmlFor="syl-subject">
          <select id="syl-subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} style={{ maxWidth: 280 }}>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </select>
        </Field>
      </div>

      {loading ? (
        <Skeleton lines={5} />
      ) : loadError ? (
        <EmptyState title="Couldn't load the syllabus." message="Try again shortly." />
      ) : (
        <>
          {editable ? (
            <Card title="Add a unit">
              <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end", flexWrap: "wrap" }}>
                <Field label="Title" htmlFor="unit-title">
                  <input id="unit-title" value={newUnitTitle} onChange={(event) => setNewUnitTitle(event.target.value)} />
                </Field>
                <Button onClick={() => void addUnit()} loading={saving} disabled={newUnitTitle.trim() === ""}>
                  Add unit
                </Button>
              </div>
            </Card>
          ) : null}

          {units.length === 0 ? (
            <EmptyState
              title={editable ? "No syllabus yet — add the first unit." : "No syllabus published for this subject."}
            />
          ) : (
            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              {units.map((unit) => {
                const taughtCount = unit.topics.filter((topic) => topic.taughtOn !== null).length;
                const tone = unit.coveragePct >= 100 ? "good" : unit.coveragePct > 0 ? "warn" : "bad";
                const topics = unit.topics.slice().sort((a, b) => a.position - b.position);
                return (
                  <Card
                    key={unit.id}
                    title={unit.title}
                    actions={
                      editable ? (
                        <span style={{ display: "flex", gap: 8 }}>
                          <Button
                            variant="ghost"
                            disabled={saving}
                            onClick={() => {
                              setRenameUnitTitle(unit.title);
                              setRenamingUnit(unit);
                            }}
                          >
                            Rename
                          </Button>
                          <Button variant="danger" disabled={saving} onClick={() => setDeletingUnit(unit)}>
                            Delete
                          </Button>
                        </span>
                      ) : undefined
                    }
                  >
                    <RingStat
                      pct={unit.coveragePct}
                      display={`${Math.round(unit.coveragePct)}%`}
                      label="Coverage"
                      value={`${taughtCount}/${unit.topics.length} topics`}
                      tone={tone}
                    />
                    <div style={{ marginTop: "var(--space-3)", display: "grid", gap: 4 }}>
                      {topics.length === 0 ? (
                        <p className="strip-empty">No topics yet.</p>
                      ) : (
                        topics.map((topic) => (
                          <div
                            key={topic.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                              padding: "6px 0",
                              borderTop: "1px solid var(--rule)",
                            }}
                          >
                            <span>
                              {topic.title}{" "}
                              {topic.taughtOn !== null ? (
                                <Badge tone="good">taught {topic.taughtOn}</Badge>
                              ) : (
                                <Badge tone="warn">pending</Badge>
                              )}
                            </span>
                            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              {editable ? (
                                <>
                                  <input
                                    type="date"
                                    aria-label={`Taught date for ${topic.title}`}
                                    value={topic.taughtOn ?? today}
                                    disabled={saving}
                                    onChange={(event) => void markTaught(topic, event.target.value)}
                                  />
                                  <Button
                                    variant="ghost"
                                    disabled={saving}
                                    onClick={() => {
                                      setRenameTopicTitle(topic.title);
                                      setRenamingTopic(topic);
                                    }}
                                  >
                                    Rename
                                  </Button>
                                  <Button variant="danger" disabled={saving} onClick={() => setDeletingTopic(topic)}>
                                    Delete
                                  </Button>
                                </>
                              ) : null}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                    {editable ? (
                      <div style={{ display: "flex", gap: 8, marginTop: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
                        <Field label="New topic" htmlFor={`topic-${unit.id}`}>
                          <input
                            id={`topic-${unit.id}`}
                            value={newTopicTitle[unit.id] ?? ""}
                            onChange={(event) => setNewTopicTitle((current) => ({ ...current, [unit.id]: event.target.value }))}
                          />
                        </Field>
                        <Button variant="ghost" disabled={saving || (newTopicTitle[unit.id] ?? "").trim() === ""} onClick={() => void addTopicTo(unit)}>
                          Add topic
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal
        open={renamingUnit !== null}
        onClose={() => setRenamingUnit(null)}
        title="Rename unit"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenamingUnit(null)}>Cancel</Button>
            <Button onClick={() => void submitRenameUnit()} loading={saving} disabled={renameUnitTitle.trim() === ""}>Save</Button>
          </>
        }
      >
        <Field label="Title" htmlFor="rename-unit-title">
          <input id="rename-unit-title" value={renameUnitTitle} onChange={(event) => setRenameUnitTitle(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={renamingTopic !== null}
        onClose={() => setRenamingTopic(null)}
        title="Rename topic"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenamingTopic(null)}>Cancel</Button>
            <Button onClick={() => void submitRenameTopic()} loading={saving} disabled={renameTopicTitle.trim() === ""}>Save</Button>
          </>
        }
      >
        <Field label="Title" htmlFor="rename-topic-title">
          <input id="rename-topic-title" value={renameTopicTitle} onChange={(event) => setRenameTopicTitle(event.target.value)} />
        </Field>
      </Modal>

      <ConfirmDialog
        open={deletingUnit !== null}
        title="Delete unit"
        message={`Delete "${deletingUnit?.title ?? ""}" and all its topics?`}
        confirmLabel="Delete"
        danger
        onConfirm={() => void confirmDeleteUnit()}
        onCancel={() => setDeletingUnit(null)}
      />

      <ConfirmDialog
        open={deletingTopic !== null}
        title="Delete topic"
        message={`Delete "${deletingTopic?.title ?? ""}"?`}
        confirmLabel="Delete"
        danger
        onConfirm={() => void confirmDeleteTopic()}
        onCancel={() => setDeletingTopic(null)}
      />
    </>
  );
}
