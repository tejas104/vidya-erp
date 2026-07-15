"use client";
import { useEffect } from "react";
import type { StudentFlags } from "@/ui/StudentCard";

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
export function StudentDrawer({
  student,
  canManage,
  onClose,
  onChangeStatus,
}: {
  student: DrawerStudent | null;
  canManage: boolean;
  onClose: () => void;
  onChangeStatus?: (student: DrawerStudent) => void;
}) {
  const open = student !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const short = student !== null && student.pct !== null && student.pct < 75;

  return (
    <>
      <div className={`cw-scrim${open ? " open" : ""}`} onMouseDown={onClose} />
      <aside
        className={`cw-drawer${open ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={student ? `${student.name} record` : "Student record"}
      >
        {student ? (
          <>
            <div className="cw-dr-hero">
              <button className="cw-dr-close" onClick={onClose} aria-label="Close">
                ×
              </button>
              <div className="cw-dr-photo" style={{ background: student.gradient }}>
                {student.initials}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, opacity: 0.75, letterSpacing: "0.06em" }}>
                {student.rollNo} · {student.section}
              </div>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.03em", marginTop: 2 }}>
                {student.name}
              </div>
            </div>

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
                <dt>Last mark</dt>
                <dd>{student.lastMark ?? "—"}</dd>
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
                  <dt>Fees</dt>
                  <dd style={{ color: "var(--ink-3)" }}>not wired</dd>
                  <dt>Documents</dt>
                  <dd style={{ color: "var(--ink-3)" }}>not wired</dd>
                </dl>
                <div style={{ marginTop: 11 }}>
                  <span className="cw-lock">🔒 admission no · name · DOB — admin only</span>
                </div>
              </div>
            ) : null}

            <div className="cw-dr-actions">
              <button className="btn" disabled title="contact fields not wired yet">
                Edit contact
              </button>
              <button className="btn" onClick={() => onChangeStatus?.(student)}>
                Change status
              </button>
              <button className="btn" disabled title="documents not wired yet">
                Documents
              </button>
            </div>
            <p className="cw-note">
              {canManage
                ? "You see this because you are the class teacher of this section. Subject teachers see only their own subject's attendance and marks. Every edit is audited — records are never deleted, only status changes."
                : "Subject-teacher view: your subject's attendance and marks only. The class teacher sees the full record."}
            </p>
          </>
        ) : null}
      </aside>
    </>
  );
}
