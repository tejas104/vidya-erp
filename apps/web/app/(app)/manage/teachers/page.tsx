"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type AssignmentView,
  type OrgTree,
  type TeacherView,
  type UserView,
} from "@/ui/api";
import {
  useToast,
  Button,
  Input,
  Select,
  Modal,
  Table,
  StatusBadge,
  Card,
  EmptyState,
  Skeleton,
  PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
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

type Row = { teacher: ReactNode; kind: ReactNode; year: ReactNode; actions: ReactNode };

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
  const [assignmentsError, setAssignmentsError] = useState(false);
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
    setAssignmentsError(false);
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
      setAssignments(null);
      setAssignmentsError(true);
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
      toast.push({ status: "good", message: `${teacher.fullName} added.` });
      setStaffNo("");
      setFullName("");
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't add the teacher." });
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
      toast.push({ status: "good", message: `Linked — ${grants.upserted} grant(s) derived.` });
      setLinking(null);
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't link." });
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
      toast.push({ status: "good", message: "Assignment created — the identity grant derives when the teacher is linked." });
      setAssigning(null);
      if (assignClassId === classId) await loadAssignments();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't create the assignment." });
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemoval() {
    if (!removal) return;
    try {
      await api.removeAssignment(removal.id);
      toast.push({ status: "good", message: "Assignment removed (derived grant revoked)." });
      setRemoval(null);
      await loadAssignments();
    } catch (caught) {
      setRemoval(null);
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't remove." });
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
  const assignSubjects = classes.find((option) => option.classId === assignClassId)?.subjects ?? [];
  const subjectNames = new Map(tree.departments.flatMap((d) => d.subjects.map((s) => [s.id, s.name] as const)));
  const assignmentColumns: TableColumn<Row>[] = [
    { key: "teacher", header: "Teacher" },
    { key: "kind", header: "Role" },
    { key: "year", header: "Year", figure: true },
    { key: "actions", header: "" },
  ];
  const assignmentRows: Row[] = (assignments ?? []).map((row) => ({
    teacher: teacherNames[row.teacherId] ?? row.teacherId,
    kind:
      row.kind === "class_teacher" ? (
        <StatusBadge status="good">class teacher</StatusBadge>
      ) : (
        <StatusBadge status="neutral">{subjectNames.get(row.subjectId ?? "") ?? "subject"}</StatusBadge>
      ),
    year: row.academicYear,
    actions: <Button variant="danger" onClick={() => setRemoval(row)}>Remove</Button>,
  }));

  return (
    <>
      <PageHeader eyebrow="Teachers" title="Teacher records & assignments" />
      <p className={styles.lede}>
        Assignments derive scope grants once the teacher is linked to a sign-in (ADR-0015). Browse by class — teachers appear where they teach.
      </p>

      <Card title="Add a teacher">
        <div className={styles.addRow}>
          <Input id="tch-staff" label="Staff no." hint="Unique, e.g. S-1042" value={staffNo} onChange={(event) => setStaffNo(event.target.value)} />
          <Input id="tch-name" label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          <Button onClick={() => void addTeacher()} loading={saving} disabled={staffNo.trim() === "" || fullName.trim() === ""}>
            Add teacher
          </Button>
        </div>
        {recent.length > 0 ? (
          <div className={styles.recentList}>
            {recent.map((teacher) => (
              <div key={teacher.id} className={styles.recentRow}>
                <span>
                  <strong>{teacher.fullName}</strong> <span className="num">{teacher.staffNo}</span>{" "}
                  {teacher.identityUserId !== null ? (
                    <StatusBadge status="good">linked</StatusBadge>
                  ) : (
                    <StatusBadge status="warn">no sign-in</StatusBadge>
                  )}
                </span>
                <span className={styles.recentActions}>
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
        <div className={styles.classPicker}>
          <Select
            id="tch-class"
            label="Class"
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            options={classes.map((option) => ({ value: option.classId, label: option.label }))}
          />
        </div>
        <div className={styles.tableWrap}>
          <AsyncState
            loading={assignments === null && !assignmentsError}
            error={assignmentsError}
            onRetry={() => void loadAssignments()}
            isEmpty={assignments !== null && assignments.length === 0}
            empty={<EmptyState title="No assignments for this class." body="Add a teacher above, then Assign." />}
          >
            <Table columns={assignmentColumns} rows={assignmentRows} />
          </AsyncState>
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
        <Select
          id="tch-user"
          label="Identity user"
          hint="Grants for existing assignments derive on link."
          value={linkUserId}
          onChange={(event) => setLinkUserId(event.target.value)}
          options={[
            { value: "", label: "Choose…" },
            ...users.map((user) => ({ value: user.id, label: `${user.displayName} (${user.username})` })),
          ]}
        />
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
        <div className={styles.formGrid}>
          <Select
            id="asg-class"
            label="Class"
            value={assignClassId}
            onChange={(event) => {
              setAssignClassId(event.target.value);
              const subjects = classes.find((option) => option.classId === event.target.value)?.subjects ?? [];
              setAssignSubjectId(subjects[0]?.id ?? "");
            }}
            options={classes.map((option) => ({ value: option.classId, label: option.label }))}
          />
          <Select
            id="asg-kind"
            label="Role"
            hint="class_teacher records attendance; subject_teacher enters marks for one subject."
            value={assignKind}
            onChange={(event) => setAssignKind(event.target.value as typeof assignKind)}
            options={[
              { value: "subject_teacher", label: "subject_teacher" },
              { value: "class_teacher", label: "class_teacher" },
            ]}
          />
          {assignKind === "subject_teacher" ? (
            <Select
              id="asg-subject"
              label="Subject"
              value={assignSubjectId}
              onChange={(event) => setAssignSubjectId(event.target.value)}
              options={assignSubjects.map((subject) => ({ value: subject.id, label: subject.name }))}
            />
          ) : null}
        </div>
      </Modal>

      <Modal
        open={removal !== null}
        onClose={() => setRemoval(null)}
        title="Remove assignment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoval(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmRemoval()}>Confirm</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>
          Remove this assignment{removal ? ` (${teacherNames[removal.teacherId] ?? removal.teacherId})` : ""}? The derived grant is revoked first.
        </p>
      </Modal>
    </>
  );
}
