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
import { HelpButton } from "@/ui/help/HelpButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type ClassOpt = { classId: string; label: string; subjects: { id: string; name: string }[] };

function classOptions(tree: OrgTree): ClassOpt[] {
  const options: ClassOpt[] = [];
  for (const dept of tree.departments) {
    for (const klass of dept.classes) {
      options.push({
        classId: klass.id,
        label: dept.code === "__SCHOOL__" ? klass.name : `${dept.code} · ${klass.name}`,
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
  const [teachers, setTeachers] = useState<TeacherView[] | null>(null);
  const [teachersError, setTeachersError] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
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
  const [editing, setEditing] = useState<TeacherView | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState<"active" | "inactive">("active");
  const [credentialTarget, setCredentialTarget] = useState<TeacherView | null>(null);
  const [issued, setIssued] = useState<{ username: string; temporaryPassword: string } | null>(null);

  const loadTeachers = useCallback(async (collegeId: string, q: string, pageOffset: number) => {
    setTeachersError(false);
    setTeachers(null);
    try {
      const page = await api.listTeachers(collegeId, { q, offset: pageOffset, limit: 25 });
      setTeachers(page.teachers);
      setTeacherNames((current) => ({ ...current, ...Object.fromEntries(page.teachers.map((teacher) => [teacher.id, teacher.fullName])) }));
      setNextOffset(page.nextOffset);
    } catch {
      setTeachersError(true);
    }
  }, []);

  useEffect(() => {
    if (tree) void loadTeachers(tree.college.id, appliedQuery, offset);
  }, [tree, appliedQuery, offset, loadTeachers]);

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
          setUsers((await api.listUsers(college.id)).users.filter((user) => user.accountKind === "staff" && user.roles.every((role) => role === "teacher" || role === "class_teacher")));
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
  }, [classId]);
  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  async function addTeacher() {
    if (!tree || staffNo.trim() === "" || fullName.trim() === "") return;
    setSaving(true);
    try {
      const teacher = await api.createTeacher({ collegeId: tree.college.id, staffNo, fullName });
      setQuery("");
      setAppliedQuery("");
      setOffset(0);
      await loadTeachers(tree.college.id, "", 0);
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
      setTeachers((current) => current?.map((t) => (t.id === teacher.id ? teacher : t)) ?? current);
      toast.push({ status: "good", message: `Linked — ${grants.upserted} grant(s) derived.` });
      setLinking(null);
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't link." });
    } finally {
      setSaving(false);
    }
  }

  async function saveTeacher() {
    if (!editing || !editName.trim()) return;
    setSaving(true);
    try {
      const updated = await api.updateTeacher(editing.id, { fullName: editName.trim(), status: editStatus });
      setTeachers((current) => current?.map((row) => row.id === updated.id ? updated : row) ?? current);
      setTeacherNames((current) => ({ ...current, [updated.id]: updated.fullName }));
      setEditing(null);
      toast.push({ status: "good", message: `${updated.fullName} updated.` });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't update the teacher." });
    } finally {
      setSaving(false);
    }
  }

  async function issueCredential() {
    if (!credentialTarget) return;
    setSaving(true);
    try {
      const result = await api.issueTeacherCredential(credentialTarget.id);
      setTeachers((current) => current?.map((row) => row.id === result.teacher.id ? result.teacher : row) ?? current);
      setIssued({ username: result.username, temporaryPassword: result.temporaryPassword });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't issue the sign-in." });
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
    { key: "actions", header: "", align: "right" },
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
      <PageHeader
        eyebrow="Teachers"
        title="Teachers & class roles"
        lede="Keep staff records, sign-ins and teaching roles together. Open a teacher below to update their record or assign a class."
        help={<HelpButton slug="teachers" />}
      />

      <Card title="Add a teacher">
        <div className={styles.addRow}>
          <Input id="tch-staff" label="Staff no." hint="Unique, e.g. S-1042" value={staffNo} onChange={(event) => setStaffNo(event.target.value)} />
          <Input id="tch-name" label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          <Button onClick={() => void addTeacher()} loading={saving} disabled={staffNo.trim() === "" || fullName.trim() === ""}>
            Add teacher
          </Button>
        </div>
      </Card>

      <section className="section" aria-label="Teacher directory">
        <div className="section-head"><h2>Teacher directory</h2></div>
        <form className={styles.searchRow} onSubmit={(event) => { event.preventDefault(); setOffset(0); setAppliedQuery(query.trim()); }}>
          <Input id="tch-search" label="Find a teacher" hint="Search name or staff number" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Button type="submit" variant="ghost">Search</Button>
        </form>
        <AsyncState
          loading={teachers === null && !teachersError}
          error={teachersError}
          onRetry={() => tree && void loadTeachers(tree.college.id, appliedQuery, offset)}
          isEmpty={teachers !== null && teachers.length === 0}
          empty={<EmptyState title="No teachers found" body={appliedQuery ? "Try another name or staff number." : "Add the first teacher above."} />}
        >
          <div className={styles.recentList}>
            {(teachers ?? []).map((teacher) => (
              <div key={teacher.id} className={styles.recentRow}>
                <span className={styles.teacherIdentity}>
                  <strong>{teacher.fullName}</strong>
                  <span className="num">{teacher.staffNo}</span>
                  <StatusBadge status={teacher.status === "active" ? "good" : "neutral"}>{teacher.status}</StatusBadge>
                  {teacher.identityUserId !== null ? <StatusBadge status="good">sign-in ready</StatusBadge> : <StatusBadge status="warn">no sign-in</StatusBadge>}
                </span>
                <span className={styles.recentActions}>
                  <Button variant="ghost" onClick={() => { setEditing(teacher); setEditName(teacher.fullName); setEditStatus(teacher.status); }}>Edit</Button>
                  {teacher.identityUserId === null && teacher.status === "active" ? (
                    <Button variant="ghost" onClick={() => { setIssued(null); setCredentialTarget(teacher); }}>Issue sign-in</Button>
                  ) : null}
                  {teacher.identityUserId === null ? <Button variant="ghost" onClick={() => { setLinkUserId(""); setLinking(teacher); }}>Link existing</Button> : null}
                  <Button variant="ghost" onClick={() => setAssigning(teacher)}>Assign</Button>
                </span>
              </div>
            ))}
          </div>
        </AsyncState>
        <div className={styles.pager}>
          {offset > 0 ? <Button variant="ghost" onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button> : null}
          {nextOffset !== null ? <Button variant="ghost" onClick={() => setOffset(nextOffset)}>Next</Button> : null}
        </div>
      </section>

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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={`Edit ${editing?.staffNo ?? "teacher"}`}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => void saveTeacher()} loading={saving} disabled={!editName.trim()}>Save teacher</Button></>}>
        <div className={styles.formGrid}>
          <Input id="tch-edit-name" label="Full name" value={editName} onChange={(event) => setEditName(event.target.value)} />
          <Select id="tch-edit-status" label="Status" value={editStatus} onChange={(event) => setEditStatus(event.target.value as "active" | "inactive")} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
          <p className={styles.confirmMessage}>Inactive teachers lose access granted through their class assignments.</p>
        </div>
      </Modal>

      <Modal open={credentialTarget !== null} onClose={() => { setCredentialTarget(null); setIssued(null); }} title={`Sign-in for ${credentialTarget?.fullName ?? "teacher"}`}
        footer={issued ? <Button onClick={() => { setCredentialTarget(null); setIssued(null); }}>Done</Button> : <><Button variant="ghost" onClick={() => setCredentialTarget(null)}>Cancel</Button><Button onClick={() => void issueCredential()} loading={saving}>Issue sign-in</Button></>}>
        {issued ? <div className={styles.credential}><p>Give these details privately to the teacher. This temporary password is shown only now.</p><p><strong>Username</strong> <span className="num">{issued.username}</span></p><p><strong>Temporary password</strong> <span className="num">{issued.temporaryPassword}</span></p></div>
          : <p>Issue one staff account for this teacher. Their class permissions will follow their assignments.</p>}
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
