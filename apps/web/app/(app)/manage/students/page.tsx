"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, currentAcademicYear, type OrgTree, type StudentView, type StudentStatus } from "@/ui/api";
import { useToast, Button, Input, Select, Modal, Table, EmptyState, Skeleton, PageHeader, type TableColumn } from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import { HelpButton } from "@/ui/help/HelpButton";
import { useHelpEdition } from "@/ui/help/HelpEditionContext";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type SectionOpt = { sectionId: string; label: string };

/** The student lifecycle (ADR-0013 retention): the record is never deleted, only moved. */
const STATUS_OPTIONS: { value: StudentStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "backlog", label: "Backlog (ATKT)" },
  { value: "year_back", label: "Year back (detained)" },
  { value: "transferred", label: "Transferred (TC)" },
  { value: "dropped", label: "Dropped" },
  { value: "alumni", label: "Alumni" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

/** Flattens the org tree into "Class · Section" options (no student-list endpoint — browse per section). */
function sectionOptions(tree: OrgTree): SectionOpt[] {
  const options: SectionOpt[] = [];
  for (const dept of tree.departments) {
    for (const klass of dept.classes) {
      for (const section of klass.sections) {
        options.push({ sectionId: section.id, label: `${klass.name} · Sec ${section.name}` });
      }
    }
  }
  return options;
}

type Row = { admissionNo: ReactNode; name: ReactNode; status: ReactNode; actions: ReactNode };

export default function StudentsPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [roster, setRoster] = useState<StudentView[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [transfer, setTransfer] = useState<StudentView | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [dateStudent, setDateStudent] = useState<StudentView | null>(null);
  const [dateRows, setDateRows] = useState<Awaited<ReturnType<typeof api.studentHistory>>["enrollments"]>([]);
  const [dateEnrollmentId, setDateEnrollmentId] = useState("");
  const [correctStart, setCorrectStart] = useState("");
  const [correctEnd, setCorrectEnd] = useState("");
  const [expectedStart, setExpectedStart] = useState<string | null>(null);
  const [expectedEnd, setExpectedEnd] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [canCorrectDates, setCanCorrectDates] = useState(false);
  const [linking, setLinking] = useState<StudentView | null>(null);
  const [linkUserId, setLinkUserId] = useState("");
  const [editing, setEditing] = useState<StudentView | null>(null);
  const [ePhone, setEPhone] = useState("");
  const [eGuardian, setEGuardian] = useState("");
  const [eGuardianPhone, setEGuardianPhone] = useState("");
  const [eDob, setEDob] = useState("");
  const [users, setUsers] = useState<{ id: string; username: string; displayName: string }[]>([]);
  // School exits go through Promotion and exits (N6), which records the leaving date and family access.
  const statusOptions = useHelpEdition() === "school" ? STATUS_OPTIONS.filter((o) => o.value !== "transferred" && o.value !== "alumni") : STATUS_OPTIONS;

  useEffect(() => {
    void api.session().then((session) => setCanCorrectDates(session.roles.includes("admin"))).catch(() => setCanCorrectDates(false));
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
        const first = sectionOptions(loaded)[0];
        if (first) setSectionId(first.sectionId);
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

  const loadRoster = useCallback(async () => {
    if (!sectionId) return;
    setRosterError(false);
    try {
      setRoster((await api.sectionRoster(sectionId)).students);
    } catch {
      setRoster(null);
      setRosterError(true);
    }
  }, [sectionId]);
  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  async function createAndEnroll() {
    if (!tree || admissionNo.trim() === "" || fullName.trim() === "" || !entryDate) return;
    setSaving(true);
    try {
      const student = await api.createStudent({ collegeId: tree.college.id, admissionNo, fullName });
      await api.enrollStudent(student.id, { sectionId, academicYear: year, startsOn: entryDate });
      toast.push({ status: "good", message: `${fullName} enrolled.` });
      setAdding(false);
      setAdmissionNo("");
      setFullName("");
      setEntryDate("");
      await loadRoster();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't add the student." });
    } finally {
      setSaving(false);
    }
  }

  async function submitTransfer() {
    if (!transfer || !transferTo || !transferDate) return;
    setSaving(true);
    try {
      await api.enrollStudent(transfer.id, { sectionId: transferTo, academicYear: year, startsOn: transferDate });
      toast.push({ status: "good", message: `${transfer.fullName} transferred.` });
      setTransfer(null);
      setTransferDate("");
      await loadRoster();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't transfer." });
    } finally {
      setSaving(false);
    }
  }

  async function openEnrollmentDates(student: StudentView) {
    setDateStudent(student);
    setDateRows([]);
    setDateEnrollmentId("");
    try {
      const rows = (await api.studentHistory(student.id)).enrollments;
      setDateRows(rows);
      const current = rows.find((row) => row.id === student.enrollment?.id) ?? rows[0];
      if (current) selectDateRow(current);
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't load enrollment history." });
      setDateStudent(null);
    }
  }

  function selectDateRow(row: typeof dateRows[number]) {
    setDateEnrollmentId(row.id);
    setCorrectStart(row.startsOn ?? "");
    setCorrectEnd(row.endsOn ?? "");
    setExpectedStart(row.startsOn ?? null);
    setExpectedEnd(row.endsOn ?? null);
  }

  async function saveEnrollmentDates() {
    if (!dateStudent || !dateEnrollmentId || !correctStart) return;
    setSaving(true);
    try {
      await api.correctEnrollmentDates(dateStudent.id, dateEnrollmentId, { startsOn: correctStart, endsOn: correctEnd || null, expectedStartsOn: expectedStart, expectedEndsOn: expectedEnd });
      toast.push({ status: "good", message: "Verified enrollment dates saved." });
      setDateStudent(null);
      await loadRoster();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't save enrollment dates." });
    } finally { setSaving(false); }
  }

  async function submitLink() {
    if (!linking || linkUserId === "") return;
    setSaving(true);
    try {
      await api.linkStudentIdentity(linking.id, linkUserId === "__unlink" ? null : linkUserId);
      toast.push({
        status: "good",
        message: linkUserId === "__unlink" ? `${linking.fullName} unlinked.` : `${linking.fullName} linked to a sign-in.`,
      });
      setLinking(null);
      await loadRoster();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't update the link." });
    } finally {
      setSaving(false);
    }
  }

  function openEdit(row: StudentView) {
    setEditing(row);
    setEPhone(row.phone ?? "");
    setEGuardian(row.guardianName ?? "");
    setEGuardianPhone(row.guardianPhone ?? "");
    setEDob(row.dob ?? "");
  }

  async function submitEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await api.updateStudent(editing.id, {
        phone: ePhone.trim() || null,
        guardianName: eGuardian.trim() || null,
        guardianPhone: eGuardianPhone.trim() || null,
        dob: eDob.trim() || null,
      });
      toast.push({ status: "good", message: `${editing.fullName}'s profile updated.` });
      setEditing(null);
      await loadRoster();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't update." });
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(student: StudentView, next: StudentStatus) {
    if (next === student.status) return;
    try {
      await api.updateStudent(student.id, { status: next });
      toast.push({ status: "good", message: `${student.fullName} → ${STATUS_LABEL[next] ?? next}.` });
      await loadRoster();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't update." });
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

  const options = sectionOptions(tree);
  const sectionLabel = options.find((option) => option.sectionId === sectionId)?.label ?? "";
  const columns: TableColumn<Row>[] = [
    { key: "admissionNo", header: "Admission no.", figure: true },
    { key: "name", header: "Student" },
    { key: "status", header: "Status" },
    { key: "actions", header: "", align: "right" },
  ];
  const rows: Row[] = (roster ?? []).map((row) => ({
    admissionNo: row.admissionNo,
    name: (
      <a className="risk-name" href={`/students/${encodeURIComponent(row.id)}`}>
        {row.fullName}
      </a>
    ),
    status: (
      <select
        aria-label={`Status for ${row.fullName}`}
        value={row.status}
        onChange={(event) => void setStatus(row, event.target.value as StudentStatus)}
        className={styles.statusSelect}
      >
        {statusOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
        {/* keep a legacy value selectable if a record still carries it */}
        {statusOptions.every((opt) => opt.value !== row.status) ? (
          <option value={row.status}>{row.status}</option>
        ) : null}
      </select>
    ),
    actions: (
      <span className={styles.rowActions}>
        <a className="btn ghost" href={`/students/${encodeURIComponent(row.id)}`}>Open record</a>
        <Button variant="ghost" onClick={() => openEdit(row)}>Edit</Button>
        {canCorrectDates ? <Button variant="ghost" onClick={() => void openEnrollmentDates(row)}>{row.enrollment?.startsOn ? "Enrollment dates" : "Set enrollment date"}</Button> : null}
        <Button variant="ghost" onClick={() => { setLinkUserId(""); setLinking(row); }}>
          {row.identityUserId === null ? "Link sign-in" : "Sign-in ✓"}
        </Button>
        <Button variant="ghost" onClick={() => { setTransferTo(""); setTransferDate(""); setTransfer(row); }}>Transfer</Button>
      </span>
    ),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Students"
        title="Student records"
        lede="Browse a section's roster; add, transfer or deactivate students. There is no global list — students live in sections."
        actions={<Button onClick={() => setAdding(true)} disabled={options.length === 0}>Add student</Button>}
        help={<HelpButton slug="students" />}
      />

      {options.length === 0 ? (
        <EmptyState title="No sections yet." body="Create departments, classes and sections in Organisation first." />
      ) : (
        <>
          <div className={styles.sectionPicker}>
            <Select
              id="sec-pick"
              label="Section"
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              options={options.map((option) => ({ value: option.sectionId, label: option.label }))}
            />
          </div>
          <div className={styles.tableWrap}>
            <AsyncState
              loading={roster === null && !rosterError}
              error={rosterError}
              onRetry={() => void loadRoster()}
              isEmpty={roster !== null && roster.length === 0}
              empty={
                <EmptyState
                  title="No students enrolled here."
                  body="Add one with the button above."
                  action={{ label: "Add student", onClick: () => setAdding(true) }}
                />
              }
            >
              <Table columns={columns} rows={rows} scrollable={{ label: "Student roster" }} />
            </AsyncState>
          </div>
        </>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={`Add student — ${sectionLabel}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={() => void createAndEnroll()} loading={saving} disabled={admissionNo.trim() === "" || fullName.trim() === "" || !entryDate}>
              Create & enroll
            </Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <Input id="stu-adm" label="Admission no." hint="Unique, e.g. FYCS-015" value={admissionNo} onChange={(event) => setAdmissionNo(event.target.value)} />
          <Input id="stu-name" label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          <Input id="stu-start" label="Enrollment effective from" type="date" hint="Use the first day this pupil belonged to this section." value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
        </div>
      </Modal>

      <Modal
        open={transfer !== null}
        onClose={() => setTransfer(null)}
        title={`Transfer ${transfer?.fullName ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTransfer(null)}>Cancel</Button>
            <Button onClick={() => void submitTransfer()} loading={saving} disabled={transferTo === "" || !transferDate}>
              Transfer
            </Button>
          </>
        }
      >
        <Select
          id="stu-transfer"
          label="To section"
          value={transferTo}
          onChange={(event) => setTransferTo(event.target.value)}
          options={[
            { value: "", label: "Choose…" },
            ...options.filter((option) => option.sectionId !== sectionId).map((option) => ({ value: option.sectionId, label: option.label })),
          ]}
        />
        <Input id="stu-transfer-date" label="Transfer effective from" type="date" hint="The previous section ends the day before this date." value={transferDate} onChange={(event) => setTransferDate(event.target.value)} />
      </Modal>

      <Modal open={dateStudent !== null} onClose={() => setDateStudent(null)} title={`Enrollment dates — ${dateStudent?.fullName ?? ""}`} footer={<><Button variant="ghost" onClick={() => setDateStudent(null)}>Cancel</Button><Button onClick={() => void saveEnrollmentDates()} loading={saving} disabled={!dateEnrollmentId || !correctStart}>Save verified dates</Button></>}>
        <Select label="Enrollment record" value={dateEnrollmentId} onChange={(event) => { const row = dateRows.find((item) => item.id === event.target.value); if (row) selectDateRow(row); }} options={dateRows.map((row) => ({ value: row.id, label: `${row.className} · ${row.sectionName} · ${row.academicYear} (${row.status})` }))} />
        <div className={styles.formGrid}>
          <Input id="correct-start" label="Effective from" type="date" value={correctStart} disabled={!dateEnrollmentId} onChange={(event) => setCorrectStart(event.target.value)} />
          <Input id="correct-end" label="Effective through" type="date" hint="Leave blank only while this enrollment is active." value={correctEnd} disabled={!dateEnrollmentId} onChange={(event) => setCorrectEnd(event.target.value)} />
        </div>
      </Modal>

      <Modal
        open={linking !== null}
        onClose={() => setLinking(null)}
        title={`Sign-in for ${linking?.fullName ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinking(null)}>Cancel</Button>
            <Button onClick={() => void submitLink()} loading={saving} disabled={linkUserId === ""}>
              Save link
            </Button>
          </>
        }
      >
        <Select
          id="stu-link"
          label="Identity user"
          hint="The linked sign-in gets the student portal (their own attendance and marks only)."
          value={linkUserId}
          onChange={(event) => setLinkUserId(event.target.value)}
          options={[
            { value: "", label: "Choose…" },
            ...(linking?.identityUserId !== null ? [{ value: "__unlink", label: "— Unlink current sign-in —" }] : []),
            ...users.map((user) => ({ value: user.id, label: `${user.displayName} (${user.username})` })),
          ]}
        />
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit profile — ${editing?.fullName ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => void submitEdit()} loading={saving}>Save profile</Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <Input id="e-phone" label="Student phone" inputMode="tel" value={ePhone} onChange={(e) => setEPhone(e.target.value)} placeholder="+91 …" />
          <Input id="e-dob" label="Date of birth" type="date" value={eDob} onChange={(e) => setEDob(e.target.value)} />
          <Input id="e-guardian" label="Guardian name" value={eGuardian} onChange={(e) => setEGuardian(e.target.value)} placeholder="Parent / guardian" />
          <Input id="e-gphone" label="Guardian phone" inputMode="tel" value={eGuardianPhone} onChange={(e) => setEGuardianPhone(e.target.value)} placeholder="+91 …" />
        </div>
      </Modal>

    </>
  );
}
