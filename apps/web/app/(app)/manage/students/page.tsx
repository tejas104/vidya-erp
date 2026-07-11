"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, currentAcademicYear, type OrgTree, type StudentView } from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

type SectionOpt = { sectionId: string; label: string };

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

  async function toggleStatus(student: StudentView) {
    const next = student.status === "active" ? "inactive" : "active";
    try {
      await api.updateStudent(student.id, { status: next });
      toast.show(`${student.fullName} is now ${next}.`, "good");
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
      render: (row) => <Badge tone={row.status === "active" ? "good" : "warn"}>{row.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => { setTransferTo(""); setTransfer(row); }}>Transfer</Button>
          <Button variant="ghost" onClick={() => void toggleStatus(row)}>
            {row.status === "active" ? "Deactivate" : "Reactivate"}
          </Button>
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
    </>
  );
}
