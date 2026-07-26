"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type OrgTree, type StudentView, type StudentDocument } from "@/ui/api";
import { Button, Select, Modal, Table, EmptyState, Skeleton, PageHeader, type TableColumn } from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import { StudentSlideOver, type DrawerStudent } from "@/ui/StudentSlideOver";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type SectionOpt = { sectionId: string; label: string };

const AVATARS = [
  "linear-gradient(140deg,#6B7BFF,#4A5BD8)",
  "linear-gradient(140deg,#F59E0B,#D97706)",
  "linear-gradient(140deg,#10B981,#059669)",
  "linear-gradient(140deg,#8B5CF6,#7C3AED)",
  "linear-gradient(140deg,#EC4899,#DB2777)",
  "linear-gradient(140deg,#06B6D4,#0891B2)",
];
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "·";
}

/** Flattens the org tree into "Class · Section" options — students live in sections. */
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

type Row = { admissionNo: ReactNode; name: ReactNode; status: ReactNode; guardian: ReactNode; actions: ReactNode };

/**
 * Read-only student directory for the accountant: browse rosters and view
 * documents to reconcile against fees. Every endpoint here is already
 * accountant-readable (college-wide read grant + ScopeChecker); this page adds
 * no writes — no add, edit, status, upload or delete. The "View" affordance
 * opens the StudentSlideOver's overview tab (canManage=false — no fees/
 * documents/status controls there); the existing "View documents" flow stays
 * a separate read-only modal, since the slide-over's canManage=false path
 * hides documents entirely and this screen's whole purpose is showing them.
 */
export default function DirectoryPage() {
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [roster, setRoster] = useState<StudentView[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [viewing, setViewing] = useState<StudentView | null>(null);
  const [docs, setDocs] = useState<StudentDocument[] | null>(null);
  const [peeking, setPeeking] = useState<StudentView | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { colleges } = await api.colleges();
        const college = colleges[0];
        if (!college) { setFailed(true); return; }
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
    setRoster(null);
    setRosterError(false);
    try {
      setRoster((await api.sectionRoster(sectionId)).students);
    } catch {
      setRoster(null);
      setRosterError(true);
    }
  }, [sectionId]);
  useEffect(() => { void loadRoster(); }, [loadRoster]);

  useEffect(() => {
    if (viewing === null) { setDocs(null); return; }
    let alive = true;
    api.docList(viewing.id).then((r) => alive && setDocs(r.documents)).catch(() => alive && setDocs([]));
    return () => { alive = false; };
  }, [viewing]);

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
    { key: "guardian", header: "Guardian" },
    { key: "actions", header: "" },
  ];
  const rows: Row[] = (roster ?? []).map((row) => ({
    admissionNo: row.admissionNo,
    name: row.fullName,
    status: row.status,
    guardian: row.guardianName ?? "—",
    actions: (
      <span className={styles.rowActions}>
        <Button variant="ghost" onClick={() => setPeeking(row)}>View</Button>
        <button type="button" className="linklike" onClick={() => setViewing(row)}>
          View documents
        </button>
      </span>
    ),
  }));

  return (
    <>
      <PageHeader eyebrow="Records" title="Student directory" />
      <p className={styles.lede}>
        Browse rosters and student documents — read-only, for reconciling fees and records. Nothing here can be changed.
      </p>

      {options.length === 0 ? (
        <EmptyState title="No sections yet." body="An administrator sets up departments, classes and sections first." />
      ) : (
        <>
          <div className={styles.sectionPicker}>
            <Select
              id="dir-sec"
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
              empty={<EmptyState title="No students enrolled here." />}
            >
              <Table columns={columns} rows={rows} />
            </AsyncState>
          </div>
        </>
      )}

      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={`${viewing?.fullName ?? ""} — record`}
      >
        <dl className={styles.recordGrid}>
          <dt className={styles.recordLabel}>Admission no.</dt><dd className={`${styles.recordValue} num`}>{viewing?.admissionNo}</dd>
          <dt className={styles.recordLabel}>Status</dt><dd className={styles.recordValue}>{viewing?.status}</dd>
          <dt className={styles.recordLabel}>Phone</dt><dd className={styles.recordValue}>{viewing?.phone ?? "—"}</dd>
          <dt className={styles.recordLabel}>Guardian</dt><dd className={styles.recordValue}>{viewing?.guardianName ?? "—"}{viewing?.guardianPhone ? ` · ${viewing.guardianPhone}` : ""}</dd>
          <dt className={styles.recordLabel}>Date of birth</dt><dd className={styles.recordValue}>{viewing?.dob ?? "—"}</dd>
        </dl>

        <h4 className={styles.docsHeading}>Documents</h4>
        {docs === null ? (
          <div className="strip-empty">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="strip-empty">No documents on file.</div>
        ) : (
          <div className={styles.docsList}>
            {docs.map((d) => (
              <div key={d.id} className={styles.docRow}>
                <span className={styles.docName}>
                  <span className="chip">{d.kind}</span>
                  {d.filename}
                </span>
                <a className="linklike" href={api.docDownloadUrl(d.id)} target="_blank" rel="noreferrer">view</a>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <StudentSlideOver
        student={
          peeking
            ? ({
                studentId: peeking.id,
                initials: initials(peeking.fullName),
                gradient: AVATARS[(roster ?? []).indexOf(peeking) % AVATARS.length]!,
                rollNo: peeking.admissionNo,
                name: peeking.fullName,
                section: sectionLabel,
                status: peeking.status,
                pct: null,
                attended: 0,
                total: 0,
                lastMark: null,
                backlogs: peeking.status === "backlog" ? 1 : 0,
                flags: { backlog: peeking.status === "backlog", yb: peeking.status === "year_back" },
                phone: peeking.phone,
                guardianName: peeking.guardianName,
                guardianPhone: peeking.guardianPhone,
                dob: peeking.dob,
              } satisfies DrawerStudent)
            : null
        }
        canManage={false}
        onClose={() => setPeeking(null)}
      />
    </>
  );
}
