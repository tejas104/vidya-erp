"use client";
import { useEffect, useRef, useState } from "react";
import { SlideOver, Tabs } from "@vidya/ui-system";
import { api, type DocumentKind, type StudentDocument } from "@/ui/api";
import { formatPaise } from "@/ui/money";
import type { StudentFlags } from "@/ui/StudentCard";
import { ago } from "@/ui/time";
import styles from "./StudentSlideOver.module.css";

const DOC_KINDS: { value: DocumentKind; label: string }[] = [
  { value: "photo", label: "Photo" },
  { value: "id_proof", label: "ID proof" },
  { value: "marksheet", label: "Marksheet" },
  { value: "tc", label: "Transfer certificate" },
  { value: "other", label: "Other" },
];
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 5 * 1024 * 1024;

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "attendance", label: "Attendance" },
  { id: "marks", label: "Marks" },
  { id: "fees", label: "Fees" },
  { id: "documents", label: "Documents" },
];

export interface DrawerStudent {
  studentId: string;
  initials: string;
  gradient: string;
  rollNo: string;
  name: string;
  section: string;
  status: string;
  pct: number | null;
  attended: number;
  total: number;
  lastMark: string | null;
  backlogs: number;
  flags: StudentFlags;
  phone: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  dob: string | null;
}

/** classes needed at ≥75% to clear the short-attendance line. */
function classesToReach75(attended: number, total: number): number {
  if (total === 0) return 0;
  return Math.max(0, Math.ceil((0.75 * total - attended) / 0.25));
}

/**
 * Student mini-profile as a slide-over. The "Class-teacher view" section and
 * the locked admission-no/name/DOB fields are gated by `canManage`, which the
 * caller supplies from a STUBBED scope check — the real "is class teacher of
 * this section" grant is authored server-side (see the page).
 * There is deliberately NO delete action; status change only.
 */
const LIFECYCLE: { value: string; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "backlog", label: "Backlog (ATKT)" },
  { value: "year_back", label: "Year back" },
  { value: "transferred", label: "Transferred (TC)" },
  { value: "dropped", label: "Dropped" },
  { value: "alumni", label: "Alumni" },
];

export function StudentSlideOver({
  student,
  canManage = false,
  onClose,
  onSetStatus,
}: {
  student: DrawerStudent | null;
  canManage?: boolean;
  onClose: () => void;
  /** Class teacher / admin changes the student's lifecycle status (2.4). */
  onSetStatus?: (status: string) => void;
}) {
  const open = student !== null;
  const [tab, setTab] = useState<string>("overview");
  const [docs, setDocs] = useState<StudentDocument[] | null>(null);
  /** outstanding dues in paise; null = loading; "na" = couldn't read (out of scope). */
  const [feesDue, setFeesDue] = useState<number | null | "na">(null);
  const [uploading, setUploading] = useState(false);
  const [docErr, setDocErr] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>("photo");
  const fileRef = useRef<HTMLInputElement>(null);
  const studentId = student?.studentId;

  useEffect(() => {
    setTab("overview");
  }, [studentId]);

  useEffect(() => {
    if (studentId === undefined || !canManage) { setDocs(null); return; }
    let alive = true;
    setDocErr(null);
    api.docList(studentId).then((r) => alive && setDocs(r.documents)).catch(() => alive && setDocs([]));
    return () => { alive = false; };
  }, [studentId, canManage]);

  useEffect(() => {
    if (studentId === undefined || !canManage) { setFeesDue(null); return; }
    let alive = true;
    setFeesDue(null);
    api.feesStudentInvoices(studentId)
      .then((r) => alive && setFeesDue(r.invoices.reduce((sum, inv) => sum + inv.duesPaise, 0)))
      .catch(() => alive && setFeesDue("na"));
    return () => { alive = false; };
  }, [studentId, canManage]);

  async function upload(file: File) {
    if (studentId === undefined) return;
    if (file.size > MAX_BYTES) { setDocErr("File exceeds the 5 MB limit."); return; }
    setUploading(true);
    setDocErr(null);
    try {
      const dataBase64 = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res((fr.result as string).split(",")[1] ?? "");
        fr.onerror = () => rej(new Error("read failed"));
        fr.readAsDataURL(file);
      });
      await api.docUpload(studentId, { kind, filename: file.name, contentType: file.type, dataBase64 });
      setDocs((await api.docList(studentId)).documents);
    } catch {
      setDocErr("Upload failed — images (JPEG/PNG/WebP) or PDF only, up to 5 MB.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeDoc(id: string) {
    if (studentId === undefined) return;
    try {
      await api.docDelete(id);
      setDocs((await api.docList(studentId)).documents);
    } catch {
      setDocErr("Couldn't delete that document.");
    }
  }

  const photo = docs?.find((d) => d.kind === "photo") ?? null;
  const short = student !== null && student.pct !== null && student.pct < 75;

  return (
    <SlideOver open={open} onClose={onClose} title={student?.name ?? ""}>
      {student ? (
        <>
          <div className={styles.hero}>
            <div className={styles.avatar} style={{ background: student.gradient || undefined }}>
              {photo ? (
                <img className={styles.avatarImg} src={api.docDownloadUrl(photo.id)} alt="" />
              ) : (
                student.initials
              )}
            </div>
            <div className={styles.meta}>{student.rollNo} · {student.section}</div>
          </div>

          <Tabs tabs={TABS} active={tab} onChange={setTab} />

          <div className={styles.panel}>
            {tab === "overview" ? (
              <>
                <div className="cw-dr-sec">
                  <h4>Status</h4>
                  <dl className="cw-dl">
                    <dt>Status</dt>
                    <dd>{student.status}</dd>
                    {student.backlogs > 0 ? (
                      <>
                        <dt>Backlogs</dt>
                        <dd style={{ color: "var(--warn)" }}>{student.backlogs} active</dd>
                      </>
                    ) : null}
                  </dl>
                </div>

                {canManage ? (
                  <div className="cw-dr-sec">
                    <h4>Class-teacher view</h4>
                    <dl className="cw-dl">
                      <dt>Guardian</dt>
                      <dd>
                        {student.guardianName ?? "—"}
                        {student.guardianPhone ? ` · ${student.guardianPhone}` : ""}
                      </dd>
                      <dt>Phone</dt>
                      <dd>{student.phone ?? "—"}</dd>
                      <dt>Date of birth</dt>
                      <dd>{student.dob ?? "—"}</dd>
                    </dl>
                    <div style={{ marginTop: 11 }}>
                      <span className="cw-lock">🔒 admission no · name · DOB — admin only</span>
                    </div>
                  </div>
                ) : null}

                {canManage ? (
                  <div className="cw-dr-actions" style={{ alignItems: "flex-end" }}>
                    <label className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
                      <span style={{ fontSize: 12 }}>Change status (audited, never deleted)</span>
                      <select value={student.status} onChange={(e) => onSetStatus?.(e.target.value)}>
                        {LIFECYCLE.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                        {LIFECYCLE.every((o) => o.value !== student.status) ? (
                          <option value={student.status}>{student.status}</option>
                        ) : null}
                      </select>
                    </label>
                  </div>
                ) : null}

                <p className="cw-note">
                  {canManage
                    ? "You see this because you are the class teacher of this section. Subject teachers see only their own subject's attendance and marks. Every edit is audited — records are never deleted, only status changes."
                    : "Subject-teacher view: your subject's attendance and marks only. The class teacher sees the full record."}
                </p>
              </>
            ) : null}

            {tab === "attendance" ? (
              <div className="cw-dr-sec">
                <h4>Academic standing</h4>
                <dl className="cw-dl">
                  <dt>Attendance</dt>
                  <dd style={{ color: short ? "var(--bad)" : "var(--good)" }}>
                    {student.pct === null ? "—" : `${student.pct}% ${short ? "· short" : "· clear"}`}
                  </dd>
                  {short ? (
                    <>
                      <dt>To reach 75%</dt>
                      <dd>next {classesToReach75(student.attended, student.total)} classes</dd>
                    </>
                  ) : null}
                </dl>
              </div>
            ) : null}

            {tab === "marks" ? (
              <div className="cw-dr-sec">
                <h4>Marks</h4>
                <dl className="cw-dl">
                  <dt>Last mark</dt>
                  <dd>{student.lastMark ?? "—"}</dd>
                </dl>
              </div>
            ) : null}

            {tab === "fees" ? (
              canManage ? (
                <div className="cw-dr-sec">
                  <h4>Fees</h4>
                  <dl className="cw-dl">
                    <dt>Fees</dt>
                    <dd style={{ color: feesDue === null || feesDue === "na" ? "var(--ink-3)" : feesDue > 0 ? "var(--bad)" : "var(--good)" }}>
                      {feesDue === null ? "…" : feesDue === "na" ? "—" : feesDue > 0 ? `${formatPaise(feesDue)} due` : "cleared"}
                    </dd>
                  </dl>
                </div>
              ) : (
                <p className="cw-note">Subject-teacher view: fees are visible to the class teacher only.</p>
              )
            ) : null}

            {tab === "documents" ? (
              canManage ? (
                <div className="cw-dr-sec">
                  <h4>Documents</h4>
                  {docs === null ? (
                    <div className="strip-empty">Loading…</div>
                  ) : docs.length === 0 ? (
                    <div className="strip-empty">No documents yet.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                      {docs.map((d) => (
                        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span className="cw-badge" style={{ marginRight: 6, background: "var(--line-2)", color: "var(--ink-2)" }}>{d.kind}</span>
                            {d.filename}
                          </span>
                          <span className="num" style={{ color: "var(--ink-3)", flex: "none" }}>{ago(d.createdAt)}</span>
                          <a className="linklike" href={api.docDownloadUrl(d.id)} target="_blank" rel="noreferrer">view</a>
                          <button className="linklike" style={{ color: "var(--bad)", background: "none", border: 0, cursor: "pointer" }} onClick={() => void removeDoc(d.id)}>remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} style={{ font: "inherit", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--rule-strong)", background: "var(--paper-raised)", color: "var(--ink)" }}>
                      {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                    <input
                      ref={fileRef}
                      type="file"
                      accept={ACCEPT}
                      disabled={uploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
                      style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}
                    />
                  </div>
                  <p className="field-hint" style={{ marginTop: 6 }}>Images or PDF, up to 5 MB. A “photo” becomes the student’s avatar.</p>
                  {docErr ? <p className="formerror" style={{ margin: "4px 0 0" }}>{docErr}</p> : null}
                </div>
              ) : (
                <p className="cw-note">Subject-teacher view: documents are visible to the class teacher only.</p>
              )
            ) : null}
          </div>
        </>
      ) : null}
    </SlideOver>
  );
}
