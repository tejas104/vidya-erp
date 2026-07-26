"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type OrgTree, type OrgUnitType } from "@/ui/api";
import { useToast, Button, Input, Modal, StatusBadge, Card, EmptyState, PageHeader } from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type CreatableUnit = "department" | "class" | "section" | "subject";
type Editor =
  | { kind: "create"; unit: CreatableUnit; parentId: string; parentLabel: string }
  | { kind: "rename"; unit: OrgUnitType; unitId: string; currentName: string };
type Doomed = { unit: OrgUnitType; unitId: string; label: string };

const HAS_CODE: Record<CreatableUnit, boolean> = { department: true, class: true, subject: true, section: false };

export default function OrgPage() {
  const toast = useToast();
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [doomed, setDoomed] = useState<Doomed | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { colleges } = await api.colleges();
      const college = colleges[0];
      if (!college) {
        setFailed(true);
        return;
      }
      setTree(await api.collegeTree(college.id));
    } catch {
      setTree(null);
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(unit: CreatableUnit, parentId: string, parentLabel: string) {
    setName("");
    setCode("");
    setEditor({ kind: "create", unit, parentId, parentLabel });
  }
  function openRename(unit: OrgUnitType, unitId: string, currentName: string) {
    setName(currentName);
    setEditor({ kind: "rename", unit, unitId, currentName });
  }

  async function submitEditor() {
    if (!editor || name.trim() === "") return;
    setSaving(true);
    try {
      if (editor.kind === "create") {
        if (editor.unit === "department") await api.createDepartment({ collegeId: editor.parentId, name, code });
        else if (editor.unit === "class") await api.createClass({ departmentId: editor.parentId, name, code });
        else if (editor.unit === "subject") await api.createSubject({ departmentId: editor.parentId, name, code });
        else await api.createSection({ classId: editor.parentId, name });
        toast.push({ status: "good", message: `${editor.unit[0]!.toUpperCase()}${editor.unit.slice(1)} "${name}" created.` });
      } else {
        await api.renameOrgUnit(editor.unit, editor.unitId, name);
        toast.push({ status: "good", message: "Renamed." });
      }
      setEditor(null);
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!doomed) return;
    try {
      await api.deleteOrgUnit(doomed.unit, doomed.unitId);
      toast.push({ status: "good", message: `Deleted "${doomed.label}".` });
      setDoomed(null);
      await load();
    } catch (caught) {
      setDoomed(null);
      toast.push({
        status: "danger",
        message:
          caught instanceof ApiError && caught.status === 409
            ? `"${doomed.label}" still has children or records — remove those first.`
            : "Couldn't delete.",
      });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title={tree?.college.name ?? "Organisation"}
        actions={
          tree ? <Button onClick={() => openCreate("department", tree.college.id, tree.college.name)}>New department</Button> : undefined
        }
      />
      <p className={styles.lede}>
        Departments, classes, sections and subjects. Deleting is blocked while a unit still has children or records.
      </p>

      <AsyncState
        loading={tree === null && !failed}
        error={failed}
        onRetry={() => void load()}
        isEmpty={tree !== null && tree.departments.length === 0}
        empty={<EmptyState title="No departments yet." body="Create the first department to start building the college." />}
      >
        <div className={styles.deptGrid}>
          {tree?.departments.map((dept) => (
            <Card
              key={dept.id}
              title={`${dept.name} · ${dept.code}`}
              actions={
                <span className={styles.cardActions}>
                  <Button variant="ghost" onClick={() => openCreate("class", dept.id, dept.name)}>New class</Button>
                  <Button variant="ghost" onClick={() => openCreate("subject", dept.id, dept.name)}>New subject</Button>
                  <Button variant="ghost" onClick={() => openRename("department", dept.id, dept.name)}>Rename</Button>
                  <Button variant="danger" onClick={() => setDoomed({ unit: "department", unitId: dept.id, label: dept.name })}>
                    Delete
                  </Button>
                </span>
              }
            >
              {dept.classes.length === 0 ? (
                <p className="strip-empty">No classes yet.</p>
              ) : (
                dept.classes.map((klass) => (
                  <div key={klass.id} className={styles.classRow}>
                    <span>
                      <strong>{klass.name}</strong> <span className="num">{klass.code}</span>
                    </span>
                    <span className={styles.classRowActions}>
                      {klass.sections.map((section) => (
                        <StatusBadge key={section.id} status="neutral">Sec {section.name}</StatusBadge>
                      ))}
                      <Button variant="ghost" onClick={() => openCreate("section", klass.id, klass.name)}>New section</Button>
                      <Button variant="ghost" onClick={() => openRename("class", klass.id, klass.name)}>Rename</Button>
                      <Button variant="danger" onClick={() => setDoomed({ unit: "class", unitId: klass.id, label: klass.name })}>
                        Delete
                      </Button>
                    </span>
                  </div>
                ))
              )}
              {dept.subjects.length > 0 ? (
                <div className={styles.subjectRow}>
                  <span className="stat-sub num">subjects</span>
                  {dept.subjects.map((subject) => (
                    <StatusBadge key={subject.id} status="good">{subject.name}</StatusBadge>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      </AsyncState>

      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={
          editor?.kind === "rename"
            ? `Rename ${editor.unit}`
            : editor
              ? `New ${editor.unit} — ${editor.parentLabel}`
              : ""
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>Cancel</Button>
            <Button onClick={() => void submitEditor()} loading={saving} disabled={name.trim() === ""}>
              {editor?.kind === "rename" ? "Rename" : "Create"}
            </Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <Input id="org-name" label="Name" value={name} onChange={(event) => setName(event.target.value)} />
          {editor?.kind === "create" && HAS_CODE[editor.unit] ? (
            <Input id="org-code" label="Code" hint="Short unique code, e.g. CSE" value={code} onChange={(event) => setCode(event.target.value)} />
          ) : null}
        </div>
      </Modal>

      <Modal
        open={doomed !== null}
        onClose={() => setDoomed(null)}
        title={`Delete ${doomed?.unit ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDoomed(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>Confirm</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>
          Delete &quot;{doomed?.label ?? ""}&quot;? This only works when it has no children or records.
        </p>
      </Modal>
    </>
  );
}
