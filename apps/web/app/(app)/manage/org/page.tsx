"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type OrgTree, type OrgUnitType } from "@/ui/api";
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
    try {
      const { colleges } = await api.colleges();
      const college = colleges[0];
      if (!college) {
        setFailed(true);
        return;
      }
      setTree(await api.collegeTree(college.id));
    } catch {
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
        toast.show(`${editor.unit[0]!.toUpperCase()}${editor.unit.slice(1)} "${name}" created.`, "good");
      } else {
        await api.renameOrgUnit(editor.unit, editor.unitId, name);
        toast.show("Renamed.", "good");
      }
      setEditor(null);
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't save.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!doomed) return;
    try {
      await api.deleteOrgUnit(doomed.unit, doomed.unitId);
      toast.show(`Deleted "${doomed.label}".`, "good");
      setDoomed(null);
      await load();
    } catch (caught) {
      setDoomed(null);
      toast.show(
        caught instanceof ApiError && caught.status === 409
          ? `"${doomed.label}" still has children or records — remove those first.`
          : "Couldn't delete.",
        "danger",
      );
    }
  }

  if (failed) {
    return <EmptyState title="Couldn't load the organisation." message="Try again shortly." />;
  }
  if (tree === null) {
    return <Skeleton lines={5} />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title={tree.college.name}
        lede="Departments, classes, sections and subjects. Deleting is blocked while a unit still has children or records."
        actions={
          <Button onClick={() => openCreate("department", tree.college.id, tree.college.name)}>New department</Button>
        }
      />

      {tree.departments.length === 0 ? (
        <EmptyState
          title="No departments yet."
          message="Create the first department to start building the college."
        />
      ) : (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          {tree.departments.map((dept) => (
            <Card
              key={dept.id}
              title={`${dept.name} · ${dept.code}`}
              actions={
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                  <div key={klass.id} style={{ padding: "10px 0", borderTop: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span>
                      <strong>{klass.name}</strong> <span className="num" style={{ opacity: 0.6 }}>{klass.code}</span>
                    </span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {klass.sections.map((section) => (
                        <Badge key={section.id}>Sec {section.name}</Badge>
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
                <div style={{ marginTop: "var(--space-3)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="stat-sub num">subjects</span>
                  {dept.subjects.map((subject) => (
                    <Badge key={subject.id} tone="good">{subject.name}</Badge>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

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
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Name" htmlFor="org-name">
            <input id="org-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          {editor?.kind === "create" && HAS_CODE[editor.unit] ? (
            <Field label="Code" htmlFor="org-code" hint="Short unique code, e.g. CSE">
              <input id="org-code" value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={doomed !== null}
        title={`Delete ${doomed?.unit ?? ""}`}
        message={`Delete "${doomed?.label ?? ""}"? This only works when it has no children or records.`}
        confirmLabel="Confirm"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDoomed(null)}
      />
    </>
  );
}
