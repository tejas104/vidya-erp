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
import { AsyncState } from "@/ui/AsyncState";
import {
  useToast,
  Button,
  Input,
  Select,
  Modal,
  Card,
  StatusBadge,
  StatCard,
  EmptyState,
  Skeleton,
  PageHeader,
} from "@vidya/ui-system";
import styles from "./page.module.css";

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
      toast.push({ status: "good", message: `Unit "${newUnitTitle}" added.` });
      setNewUnitTitle("");
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: saveErrorMessage(caught, "Couldn't add the unit.") });
    } finally {
      setSaving(false);
    }
  }

  async function submitRenameUnit() {
    if (!renamingUnit || renameUnitTitle.trim() === "") return;
    setSaving(true);
    try {
      await api.updateUnit(renamingUnit.id, { title: renameUnitTitle });
      toast.push({ status: "good", message: "Unit renamed." });
      setRenamingUnit(null);
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: saveErrorMessage(caught, "Couldn't rename the unit.") });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteUnit() {
    if (!deletingUnit) return;
    try {
      await api.deleteUnit(deletingUnit.id);
      toast.push({ status: "good", message: "Unit deleted." });
      setDeletingUnit(null);
      await load();
    } catch (caught) {
      setDeletingUnit(null);
      toast.push({ status: "danger", message: saveErrorMessage(caught, "Couldn't delete the unit.") });
    }
  }

  async function addTopicTo(unit: UnitView) {
    const title = (newTopicTitle[unit.id] ?? "").trim();
    if (title === "") return;
    setSaving(true);
    try {
      await api.addTopic(unit.id, { title });
      toast.push({ status: "good", message: `Topic "${title}" added.` });
      setNewTopicTitle((current) => ({ ...current, [unit.id]: "" }));
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: saveErrorMessage(caught, "Couldn't add the topic.") });
    } finally {
      setSaving(false);
    }
  }

  async function submitRenameTopic() {
    if (!renamingTopic || renameTopicTitle.trim() === "") return;
    setSaving(true);
    try {
      await api.updateTopic(renamingTopic.id, { title: renameTopicTitle });
      toast.push({ status: "good", message: "Topic renamed." });
      setRenamingTopic(null);
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: saveErrorMessage(caught, "Couldn't rename the topic.") });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteTopic() {
    if (!deletingTopic) return;
    try {
      await api.deleteTopic(deletingTopic.id);
      toast.push({ status: "good", message: "Topic deleted." });
      setDeletingTopic(null);
      await load();
    } catch (caught) {
      setDeletingTopic(null);
      toast.push({ status: "danger", message: saveErrorMessage(caught, "Couldn't delete the topic.") });
    }
  }

  async function markTaught(topic: TopicView, value: string) {
    setSaving(true);
    try {
      await api.setTopicCoverage(topic.id, value === "" ? null : value);
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: saveErrorMessage(caught, "Couldn't update coverage.") });
    } finally {
      setSaving(false);
    }
  }

  if (failed) return <EmptyState title="Couldn't load the college." body="Try again shortly." />;
  if (tree === null) {
    return (
      <div className={styles.skeletonStack} aria-hidden="true">
        <Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} />
      </div>
    );
  }

  const classes = classOptions(tree);
  const subjects = classes.find((option) => option.classId === classId)?.subjects ?? [];
  const editable = editableSet.has(`${classId}:${subjectId}`);
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

      <div className={styles.pickerRow}>
        <Select
          id="syl-class"
          label="Class"
          value={classId}
          onChange={(event) => {
            setClassId(event.target.value);
            const nextSubjects = classes.find((option) => option.classId === event.target.value)?.subjects ?? [];
            setSubjectId(nextSubjects[0]?.id ?? "");
          }}
          options={classes.map((option) => ({ value: option.classId, label: option.label }))}
        />
        <Select
          id="syl-subject"
          label="Subject"
          value={subjectId}
          onChange={(event) => setSubjectId(event.target.value)}
          options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
        />
      </div>

      <AsyncState
        loading={syllabus === null && !loadError}
        error={loadError}
        errorMessage="Couldn't load the syllabus. Try again shortly."
        onRetry={() => void load()}
      >
        {editable ? (
          <Card title="Add a unit">
            <div className={styles.pickerRow}>
              <Input id="unit-title" label="Title" value={newUnitTitle} onChange={(event) => setNewUnitTitle(event.target.value)} />
              <Button onClick={() => void addUnit()} loading={saving} disabled={newUnitTitle.trim() === ""}>
                Add unit
              </Button>
            </div>
          </Card>
        ) : null}

        {units.length === 0 ? (
          <EmptyState title={editable ? "No syllabus yet — add the first unit." : "No syllabus published for this subject."} />
        ) : (
          <div className={styles.unitsGrid}>
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
                      <span className={styles.cardActions}>
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
                  <StatCard
                    pct={unit.coveragePct}
                    display={`${Math.round(unit.coveragePct)}%`}
                    label="Coverage"
                    value={`${taughtCount}/${unit.topics.length} topics`}
                    tone={tone}
                  />
                  <div className={styles.topicsList}>
                    {topics.length === 0 ? (
                      <p className="strip-empty">No topics yet.</p>
                    ) : (
                      topics.map((topic) => (
                        <div key={topic.id} className={styles.topicRow}>
                          <span>
                            {topic.title}{" "}
                            {topic.taughtOn !== null ? (
                              <StatusBadge status="good">taught {topic.taughtOn}</StatusBadge>
                            ) : (
                              <StatusBadge status="warn">pending</StatusBadge>
                            )}
                          </span>
                          <span className={styles.topicActions}>
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
                    <div className={styles.topicForm}>
                      <Input
                        id={`topic-${unit.id}`}
                        label="New topic"
                        value={newTopicTitle[unit.id] ?? ""}
                        onChange={(event) => setNewTopicTitle((current) => ({ ...current, [unit.id]: event.target.value }))}
                      />
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
      </AsyncState>

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
        <Input id="rename-unit-title" label="Title" value={renameUnitTitle} onChange={(event) => setRenameUnitTitle(event.target.value)} />
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
        <Input id="rename-topic-title" label="Title" value={renameTopicTitle} onChange={(event) => setRenameTopicTitle(event.target.value)} />
      </Modal>

      <Modal
        open={deletingUnit !== null}
        onClose={() => setDeletingUnit(null)}
        title="Delete unit"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingUnit(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmDeleteUnit()}>Delete</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>Delete &quot;{deletingUnit?.title ?? ""}&quot; and all its topics?</p>
      </Modal>

      <Modal
        open={deletingTopic !== null}
        onClose={() => setDeletingTopic(null)}
        title="Delete topic"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingTopic(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmDeleteTopic()}>Delete</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>Delete &quot;{deletingTopic?.title ?? ""}&quot;?</p>
      </Modal>
    </>
  );
}
