"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type OrgTree, type StudentView, type StudentDocument } from "@/ui/api";
import { PageHeader } from "@/ui/PageHeader";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { DataTable, type Column } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

type SectionOpt = { sectionId: string; label: string };

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

/**
 * Read-only student directory for the accountant: browse rosters and view
 * documents to reconcile against fees. Every endpoint here is already
 * accountant-readable (college-wide read grant + ScopeChecker); this page adds
 * no writes — no add, edit, status, upload or delete.
 */
export default function DirectoryPage() {
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [roster, setRoster] = useState<StudentView[] | null>(null);
  const [viewing, setViewing] = useState<StudentView | null>(null);
  const [docs, setDocs] = useState<StudentDocument[] | null>(null);

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
    try {
      setRoster((await api.sectionRoster(sectionId)).students);
    } catch {
      setRoster([]);
    }
  }, [sectionId]);
  useEffect(() => { void loadRoster(); }, [loadRoster]);

  useEffect(() => {
    if (viewing === null) { setDocs(null); return; }
    let alive = true;
    api.docList(viewing.id).then((r) => alive && setDocs(r.documents)).catch(() => alive && setDocs([]));
    return () => { alive = false; };
  }, [viewing]);

  if (failed) return <EmptyState title="Couldn't load the college." message="Try again shortly." />;
  if (tree === null) return <Skeleton lines={5} />;

  const options = sectionOptions(tree);
  const columns: Column<StudentView>[] = [
    { key: "admissionNo", header: "Admission no.", render: (row) => <span className="num">{row.admissionNo}</span> },
    { key: "name", header: "Student", render: (row) => row.fullName },
    { key: "status", header: "Status", render: (row) => row.status },
    { key: "guardian", header: "Guardian", render: (row) => row.guardianName ?? "—" },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <button
          type="button"
          className="linklike"
          style={{ background: "none", border: 0, cursor: "pointer", color: "var(--brand)" }}
          onClick={() => setViewing(row)}
        >
          View documents
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Student directory"
        lede="Browse rosters and student documents — read-only, for reconciling fees and records. Nothing here can be changed."
      />

      {options.length === 0 ? (
        <EmptyState title="No sections yet." message="An administrator sets up departments, classes and sections first." />
      ) : (
        <>
          <Field label="Section" htmlFor="dir-sec">
            <select id="dir-sec" value={sectionId} onChange={(event) => setSectionId(event.target.value)} style={{ maxWidth: 340 }}>
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
                empty={{ title: "No students enrolled here." }}
              />
            )}
          </div>
        </>
      )}

      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={`${viewing?.fullName ?? ""} — record`}
      >
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", margin: "0 0 16px", fontSize: 14 }}>
          <dt style={{ color: "var(--ink-3)" }}>Admission no.</dt><dd className="num" style={{ margin: 0 }}>{viewing?.admissionNo}</dd>
          <dt style={{ color: "var(--ink-3)" }}>Status</dt><dd style={{ margin: 0 }}>{viewing?.status}</dd>
          <dt style={{ color: "var(--ink-3)" }}>Phone</dt><dd style={{ margin: 0 }}>{viewing?.phone ?? "—"}</dd>
          <dt style={{ color: "var(--ink-3)" }}>Guardian</dt><dd style={{ margin: 0 }}>{viewing?.guardianName ?? "—"}{viewing?.guardianPhone ? ` · ${viewing.guardianPhone}` : ""}</dd>
          <dt style={{ color: "var(--ink-3)" }}>Date of birth</dt><dd style={{ margin: 0 }}>{viewing?.dob ?? "—"}</dd>
        </dl>

        <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Documents</h4>
        {docs === null ? (
          <div className="strip-empty">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="strip-empty">No documents on file.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {docs.map((d) => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span className="chip" style={{ marginRight: 6 }}>{d.kind}</span>
                  {d.filename}
                </span>
                <a className="linklike" href={api.docDownloadUrl(d.id)} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>view</a>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
