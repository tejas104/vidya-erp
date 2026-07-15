"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, currentAcademicYear, type OrgTree, type StudentView, type StudentStatus } from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { DataTable, type Column } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

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

export default function StudentsPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [roster, setRoster] = useState<StudentView[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [transfer, setTransfer] = useState<StudentView | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState<StudentView | null>(null);
  const [linkUserId, setLinkUserId] = useState("");
  const [editing, setEditing] = useState<StudentView | null>(null);
  const [ePhone, setEPhone] = useState("");
  const [eGuardian, setEGuardian] = useState("");
  const [eGuardianPhone, setEGuardianPhone] = useState("");
  const [eDob, setEDob] = useState("");
  const [users, setUsers] = useState<{ id: string; username: string; displayName: string }[]>([]);

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
    try {
      setRoster((await api.sectionRoster(sectionId)).students);
    } catch {
      setRoster([]);
    }
  }, [sectionId]);
  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  async function createAndEnroll() {
    if (!tree || admissionNo.trim() === "" || fullName.trim() === "") return;
    setSaving(true);
    try {
      const student = await api.createStudent({ collegeId: tree.college.id, admissionNo, fullName });
      await api.enrollStudent(student.id, { sectionId, academicYear: year });
      toast.show(`${fullName} enrolled.`, "good");
      setAdding(false);
      setAdmissionNo("");
      setFullName("");
      await loadRoster();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't add the student.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitTransfer() {
    if (!transfer || !transferTo) return;
    setSaving(true);
    try {
      await api.enrollStudent(transfer.id, { sectionId: transferTo, academicYear: year });
      toast.show(`${transfer.fullName} transferred.`, "good");
      setTransfer(null);
      await loadRoster();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't transfer.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitLink() {
    if (!linking || linkUserId === "") return;
    setSaving(true);
    try {
      await api.linkStudentIdentity(linking.id, linkUserId === "__unlink" ? null : linkUserId);
      toast.show(
        linkUserId === "__unlink" ? `${linking.fullName} unlinked.` : `${linking.fullName} linked to a sign-in.`,
        "good",
      );
      setLinking(null);
      await loadRoster();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't update the link.", "danger");
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
      toast.show(`${editing.fullName}'s profile updated.`, "good");
      setEditing(null);
      await loadRoster();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't update.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(student: StudentView, next: StudentStatus) {
    if (next === student.status) return;
    try {
      await api.updateStudent(student.id, { status: next });
      toast.show(`${student.fullName} → ${STATUS_LABEL[next] ?? next}.`, "good");
      await loadRoster();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't update.", "danger");
    }
  }

  if (failed) return <EmptyState title="Couldn't load the college." message="Try again shortly." />;
  if (tree === null) return <Skeleton lines={5} />;

  const options = sectionOptions(tree);
  const columns: Column<StudentView>[] = [
    { key: "admissionNo", header: "Admission no.", render: (row) => <span className="num">{row.admissionNo}</span> },
    {
      key: "name",
      header: "Student",
      render: (row) => (
        <a className="risk-name" href={`/students/${encodeURIComponent(row.id)}`}>
          {row.fullName}
        </a>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <select
          aria-label={`Status for ${row.fullName}`}
          value={row.status}
          onChange={(event) => void setStatus(row, event.target.value as StudentStatus)}
          style={{ font: "inherit", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--rule-strong)", background: "var(--paper-raised)", color: "var(--ink)" }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
          {/* keep a legacy value selectable if a record still carries it */}
          {STATUS_OPTIONS.every((opt) => opt.value !== row.status) ? (
            <option value={row.status}>{row.status}</option>
          ) : null}
        </select>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => openEdit(row)}>Edit</Button>
          <Button variant="ghost" onClick={() => { setLinkUserId(""); setLinking(row); }}>
            {row.identityUserId === null ? "Link sign-in" : "Sign-in ✓"}
          </Button>
          <Button variant="ghost" onClick={() => { setTransferTo(""); setTransfer(row); }}>Transfer</Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Students"
        title="Student records"
        lede="Browse a section's roster; add, transfer or deactivate students. There is no global list — students live in sections."
        actions={<Button onClick={() => setAdding(true)} disabled={options.length === 0}>Add student</Button>}
      />

      {options.length === 0 ? (
        <EmptyState title="No sections yet." message="Create departments, classes and sections in Organisation first." />
      ) : (
        <>
          <Field label="Section" htmlFor="sec-pick">
            <select id="sec-pick" value={sectionId} onChange={(event) => setSectionId(event.target.value)} style={{ maxWidth: 340 }}>
              {options.map((option) => (
                <option key={option.sectionId} value={option.sectionId}>{option.label}</option>
              ))}
            </select>
          </Field>
          <div style={{ marginTop: "var(--space-4)" }}>
            {roster === null ? (
              <Skeleton lines={4} />
            ) : (
              <DataTable
                columns={columns}
                rows={roster}
                rowKey={(row) => row.id}
                empty={{ title: "No students enrolled here.", message: "Add one with the button above." }}
              />
            )}
          </div>
        </>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={`Add student — ${options.find((option) => option.sectionId === sectionId)?.label ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={() => void createAndEnroll()} loading={saving} disabled={admissionNo.trim() === "" || fullName.trim() === ""}>
              Create & enroll
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Admission no." htmlFor="stu-adm" hint="Unique, e.g. FYCS-015">
            <input id="stu-adm" value={admissionNo} onChange={(event) => setAdmissionNo(event.target.value)} />
          </Field>
          <Field label="Full name" htmlFor="stu-name">
            <input id="stu-name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={transfer !== null}
        onClose={() => setTransfer(null)}
        title={`Transfer ${transfer?.fullName ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTransfer(null)}>Cancel</Button>
            <Button onClick={() => void submitTransfer()} loading={saving} disabled={transferTo === ""}>
              Transfer
            </Button>
          </>
        }
      >
        <Field label="To section" htmlFor="stu-transfer">
          <select id="stu-transfer" value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>
            <option value="">Choose…</option>
            {options
              .filter((option) => option.sectionId !== sectionId)
              .map((option) => (
                <option key={option.sectionId} value={option.sectionId}>{option.label}</option>
              ))}
          </select>
        </Field>
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
        <Field
          label="Identity user"
          htmlFor="stu-link"
          hint="The linked sign-in gets the student portal (their own attendance and marks only)."
        >
          <select id="stu-link" value={linkUserId} onChange={(event) => setLinkUserId(event.target.value)}>
            <option value="">Choose…</option>
            {linking?.identityUserId !== null ? <option value="__unlink">— Unlink current sign-in —</option> : null}
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.displayName} ({user.username})</option>
            ))}
          </select>
        </Field>
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
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Student phone" htmlFor="e-phone">
            <input id="e-phone" inputMode="tel" value={ePhone} onChange={(e) => setEPhone(e.target.value)} placeholder="+91 …" />
          </Field>
          <Field label="Date of birth" htmlFor="e-dob">
            <input id="e-dob" type="date" value={eDob} onChange={(e) => setEDob(e.target.value)} />
          </Field>
          <Field label="Guardian name" htmlFor="e-guardian">
            <input id="e-guardian" value={eGuardian} onChange={(e) => setEGuardian(e.target.value)} placeholder="Parent / guardian" />
          </Field>
          <Field label="Guardian phone" htmlFor="e-gphone">
            <input id="e-gphone" inputMode="tel" value={eGuardianPhone} onChange={(e) => setEGuardianPhone(e.target.value)} placeholder="+91 …" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
