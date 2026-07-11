"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type AssignmentView,
  type OrgTree,
  type TeacherView,
  type UserView,
} from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

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

export default function TeachersPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [users, setUsers] = useState<UserView[]>([]);
  const [recent, setRecent] = useState<TeacherView[]>([]);
  const [staffNo, setStaffNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  // assignments browser
  const [classId, setClassId] = useState("");
  const [assignments, setAssignments] = useState<AssignmentView[] | null>(null);
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});
  const [removal, setRemoval] = useState<AssignmentView | null>(null);
  // link + assign modals
  const [linking, setLinking] = useState<TeacherView | null>(null);
  const [linkUserId, setLinkUserId] = useState("");
  const [assigning, setAssigning] = useState<TeacherView | null>(null);
  const [assignClassId, setAssignClassId] = useState("");
  const [assignKind, setAssignKind] = useState<"subject_teacher" | "class_teacher">("subject_teacher");
  const [assignSubjectId, setAssignSubjectId] = useState("");

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
          setAssignClassId(first.classId);
          setAssignSubjectId(first.subjects[0]?.id ?? "");
        }
        try {
          setUsers((await api.listUsers(college.id)).users);
        } catch {
          setUsers([]);
        }
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const loadAssignments = useCallback(async () => {
    if (!classId) return;
    try {
      const { assignments: rows } = await api.classTeacherAssignments(classId);
      setAssignments(rows);
      const missing = [...new Set(rows.map((row) => row.teacherId))].filter((id) => teacherNames[id] === undefined);
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map(async (id) => {
            try {
              const t = await api.getTeacher(id);
              return [id, t.fullName] as const;
            } catch {
              return [id, id] as const;
            }
          }),
        );
        setTeacherNames((current) => ({ ...current, ...Object.fromEntries(fetched) }));
      }
    } catch {
      setAssignments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);
  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  async function addTeacher() {
    if (!tree || staffNo.trim() === "" || fullName.trim() === "") return;
    setSaving(true);
    try {
      const teacher = await api.createTeacher({ collegeId: tree.college.id, staffNo, fullName });
      setRecent((current) => [teacher, ...current]);
      toast.show(`${teacher.fullName} added.`, "good");
      setStaffNo("");
      setFullName("");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't add the teacher.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitLink() {
    if (!linking || linkUserId === "") return;
    setSaving(true);
    try {
      const { teacher, grants } = await api.linkTeacherIdentity(linking.id, linkUserId);
      setRecent((current) => current.map((t) => (t.id === teacher.id ? teacher : t)));
      toast.show(`Linked — ${grants.upserted} grant(s) derived.`, "good");
      setLinking(null);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't link.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitAssignment() {
    if (!assigning || assignClassId === "") return;
    if (assignKind === "subject_teacher" && assignSubjectId === "") return;
    setSaving(true);
    try {
      await api.createTeacherAssignment(assigning.id, {
        classId: assignClassId,
        ...(assignKind === "subject_teacher" ? { subjectId: assignSubjectId } : {}),
        kind: assignKind,
        academicYear: year,
      });
      toast.show("Assignment created — the identity grant derives when the teacher is linked.", "good");
      setAssigning(null);
      if (assignClassId === classId) await loadAssignments();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't create the assignment.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemoval() {
    if (!removal) return;
    try {
      await api.removeAssignment(removal.id);
      toast.show("Assignment removed (derived grant revoked).", "good");
      setRemoval(null);
      await loadAssignments();
    } catch (caught) {
      setRemoval(null);
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't remove.", "danger");
    }
  }

  if (failed) return <EmptyState title="Couldn't load the college." message="Try again shortly." />;
  if (tree === null) return <Skeleton lines={5} />;

  const classes = classOptions(tree);
  const assignSubjects = classes.find((option) => option.classId === assignClassId)?.subjects ?? [];
  const subjectNames = new Map(tree.departments.flatMap((d) => d.subjects.map((s) => [s.id, s.name] as const)));
  const assignmentColumns: Column<AssignmentView>[] = [
    { key: "teacher", header: "Teacher", render: (row) => teacherNames[row.teacherId] ?? row.teacherId },
    {
      key: "kind",
      header: "Role",
      render: (row) =>
        row.kind === "class_teacher" ? <Badge tone="good">class teacher</Badge> : <Badge>{subjectNames.get(row.subjectId ?? "") ?? "subject"}</Badge>,
    },
    { key: "year", header: "Year", render: (row) => <span className="num">{row.academicYear}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => <Button variant="danger" onClick={() => setRemoval(row)}>Remove</Button>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Teachers"
        title="Teacher records & assignments"
        lede="Assignments derive scope grants once the teacher is linked to a sign-in (ADR-0015). Browse by class — teachers appear where they teach."
      />

      <Card title="Add a teacher">
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Staff no." htmlFor="tch-staff" hint="Unique, e.g. S-1042">
            <input id="tch-staff" value={staffNo} onChange={(event) => setStaffNo(event.target.value)} />
          </Field>
          <Field label="Full name" htmlFor="tch-name">
            <input id="tch-name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </Field>
          <Button onClick={() => void addTeacher()} loading={saving} disabled={staffNo.trim() === "" || fullName.trim() === ""}>
            Add teacher
          </Button>
        </div>
        {recent.length > 0 ? (
          <div style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
            {recent.map((teacher) => (
              <div key={teacher.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                <span>
                  <strong>{teacher.fullName}</strong> <span className="num" style={{ opacity: 0.6 }}>{teacher.staffNo}</span>{" "}
                  {teacher.identityUserId !== null ? <Badge tone="good">linked</Badge> : <Badge tone="warn">no sign-in</Badge>}
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <Button variant="ghost" onClick={() => { setLinkUserId(""); setLinking(teacher); }}>Link identity</Button>
                  <Button variant="ghost" onClick={() => setAssigning(teacher)}>Assign</Button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <section className="section" aria-label="Assignments by class">
        <div className="section-head"><h2>Assignments by class</h2></div>
        <Field label="Class" htmlFor="tch-class">
          <select id="tch-class" value={classId} onChange={(event) => setClassId(event.target.value)} style={{ maxWidth: 340 }}>
            {classes.map((option) => (
              <option key={option.classId} value={option.classId}>{option.label}</option>
            ))}
          </select>
        </Field>
        <div style={{ marginTop: "var(--space-4)" }}>
          {assignments === null ? (
            <Skeleton lines={3} />
          ) : (
            <DataTable
              columns={assignmentColumns}
              rows={assignments}
              rowKey={(row) => row.id}
              empty={{ title: "No assignments for this class.", message: "Add a teacher above, then Assign." }}
            />
          )}
        </div>
      </section>

      <Modal
        open={linking !== null}
        onClose={() => setLinking(null)}
        title={`Link ${linking?.fullName ?? ""} to a sign-in`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinking(null)}>Cancel</Button>
            <Button onClick={() => void submitLink()} loading={saving} disabled={linkUserId === ""}>Link</Button>
          </>
        }
      >
        <Field label="Identity user" htmlFor="tch-user" hint="Grants for existing assignments derive on link.">
          <select id="tch-user" value={linkUserId} onChange={(event) => setLinkUserId(event.target.value)}>
            <option value="">Choose…</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.displayName} ({user.username})</option>
            ))}
          </select>
        </Field>
      </Modal>

      <Modal
        open={assigning !== null}
        onClose={() => setAssigning(null)}
        title={`Assign ${assigning?.fullName ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssigning(null)}>Cancel</Button>
            <Button
              onClick={() => void submitAssignment()}
              loading={saving}
              disabled={assignClassId === "" || (assignKind === "subject_teacher" && assignSubjectId === "")}
            >
              Create assignment
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Class" htmlFor="asg-class">
            <select
              id="asg-class"
              value={assignClassId}
              onChange={(event) => {
                setAssignClassId(event.target.value);
                const subjects = classes.find((option) => option.classId === event.target.value)?.subjects ?? [];
                setAssignSubjectId(subjects[0]?.id ?? "");
              }}
            >
              {classes.map((option) => (
                <option key={option.classId} value={option.classId}>{option.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Role" htmlFor="asg-kind" hint="class_teacher records attendance; subject_teacher enters marks for one subject.">
            <select id="asg-kind" value={assignKind} onChange={(event) => setAssignKind(event.target.value as typeof assignKind)}>
              <option value="subject_teacher">subject_teacher</option>
              <option value="class_teacher">class_teacher</option>
            </select>
          </Field>
          {assignKind === "subject_teacher" ? (
            <Field label="Subject" htmlFor="asg-subject">
              <select id="asg-subject" value={assignSubjectId} onChange={(event) => setAssignSubjectId(event.target.value)}>
                {assignSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={removal !== null}
        title="Remove assignment"
        message={`Remove this assignment${removal ? ` (${teacherNames[removal.teacherId] ?? removal.teacherId})` : ""}? The derived grant is revoked first.`}
        confirmLabel="Confirm"
        danger
        onConfirm={() => void confirmRemoval()}
        onCancel={() => setRemoval(null)}
      />
    </>
  );
}
