"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type StaffAttendancePage, type StaffPresence } from "@/ui/api";
import { HelpButton } from "@/ui/help/HelpButton";
import { Button, EmptyState, Input, PageHeader, StatusBadge, useToast } from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Draft = { status: StaffPresence | ""; note: string };
const STATUS: { value: StaffPresence; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "leave", label: "On leave" },
];

function todayLocal() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function StaffAttendancePage() {
  const router = useRouter();
  const toast = useToast();
  const [colleges, setColleges] = useState<{ id: string; name: string }[]>([]);
  const [collegeId, setCollegeId] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [date, setDate] = useState(todayLocal);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<StaffAttendancePage | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.colleges(), api.session()]).then(([result, session]) => {
      setColleges(result.colleges);
      setCollegeId(result.colleges[0]?.id ?? "");
      setCanEdit(session.roles.includes("admin"));
      if (result.colleges.length === 0) setLoading(false);
    }).catch(() => { setError(true); setLoading(false); });
  }, []);

  const load = useCallback(async () => {
    if (!collegeId) return;
    setLoading(true);
    setError(false);
    try {
      const result = await api.listStaffAttendance(collegeId, date, { q: appliedQuery, offset, limit: 50 });
      setPage(result);
      setDrafts(Object.fromEntries(result.teachers.map(({ teacher, attendance }) => [teacher.id, {
        status: attendance?.status ?? "",
        note: attendance?.note ?? "",
      }])));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [collegeId, date, appliedQuery, offset]);

  useEffect(() => { void load(); }, [load]);

  const entries = useMemo(() => (page?.teachers ?? []).flatMap(({ teacher, attendance }) => {
    const draft = drafts[teacher.id];
    if (!draft || teacher.status !== "active" || draft.status === "") return [];
    if (draft.status === attendance?.status && draft.note.trim() === (attendance?.note ?? "")) return [];
    return [{ teacherId: teacher.id, status: draft.status, note: draft.note.trim() || null }];
  }), [page, drafts]);
  const counts = useMemo(() => {
    const result = { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 };
    for (const { teacher } of page?.teachers ?? []) {
      if (teacher.status !== "active") continue;
      const status = drafts[teacher.id]?.status ?? "";
      if (status === "") result.unmarked += 1;
      else result[status] += 1;
    }
    return result;
  }, [page, drafts]);

  async function save() {
    if (!canEdit || saving || entries.length === 0) return;
    setSaving(true);
    try {
      await api.saveStaffAttendance({ collegeId, date, entries });
      toast.push({ status: "good", message: `${entries.length} teacher record${entries.length === 1 ? "" : "s"} saved.` });
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't save staff attendance." });
    } finally {
      setSaving(false);
    }
  }

  function update(teacherId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [teacherId]: { status: "", note: "", ...current[teacherId], ...patch } }));
  }

  return <>
    <button className="section-back" type="button" onClick={() => {
      if (window.history.length > 1 && window.history.state?.__NA) router.back();
      else router.push("/dashboard");
    }} aria-label="Back to previous section"><span aria-hidden="true">←</span> Back to previous section</button>
    <PageHeader eyebrow="People" title="Teacher attendance"
      lede="Record daily staff presence separately from pupil attendance. Corrections are saved with an audit trail."
      help={<HelpButton slug="staff-attendance" />}
      actions={canEdit ? <a className="linklike" href="/manage/teachers">Teacher directory</a> : undefined} />

    <section className={styles.controls} aria-label="Choose attendance date and school">
      {colleges.length > 1 ? <label className={styles.field}>School
        <select value={collegeId} onChange={(event) => { setCollegeId(event.target.value); setOffset(0); }}>
          {colleges.map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}
        </select>
      </label> : null}
      <Input id="staff-attendance-date" label="Date" type="date" value={date} onChange={(event) => { setDate(event.target.value); setOffset(0); }} />
      <form className={styles.search} onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()); setOffset(0); }}>
        <Input id="staff-attendance-search" label="Find teacher" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or staff number" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
    </section>

    {error ? <div className="state" role="alert">Couldn’t load teacher attendance. <Button variant="ghost" onClick={() => void load()}>Try again</Button></div>
      : loading ? <p className="page-lede">Loading teacher register…</p>
      : !collegeId ? <EmptyState title="No school in your scope." />
      : !page || page.teachers.length === 0 ? <EmptyState title="No teachers on this page." body="Try another search or date." />
      : <>
        <div className={styles.summary} aria-live="polite">
          <StatusBadge status="good">{counts.present} present</StatusBadge>
          <StatusBadge status="danger">{counts.absent} absent</StatusBadge>
          <StatusBadge status="warn">{counts.late} late</StatusBadge>
          <StatusBadge status="neutral">{counts.leave} on leave</StatusBadge>
          <span>{counts.unmarked} not marked · {page.teachers.length} shown</span>
        </div>
        {canEdit ? <div className={styles.toolbar}>
          <Button variant="secondary" disabled={saving || counts.unmarked === 0} onClick={() => setDrafts((current) => Object.fromEntries(page.teachers.map(({ teacher }) => [teacher.id,
            teacher.status === "active" && !current[teacher.id]?.status
              ? { status: "present", note: current[teacher.id]?.note ?? "" }
              : current[teacher.id] ?? { status: "", note: "" },
          ]))) }>Mark unmarked present</Button>
          <span>Review exceptions before saving. Only changed rows are submitted.</span>
        </div> : <p className={styles.readOnly}>Read only · an administrator records or corrects staff presence.</p>}
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th scope="col">Teacher</th><th scope="col">Presence</th><th scope="col">Note</th><th scope="col">Recorded</th></tr></thead>
          <tbody>{page.teachers.map(({ teacher, attendance }) => {
            const draft = drafts[teacher.id] ?? { status: "", note: "" };
            const editable = canEdit && teacher.status === "active";
            return <tr key={teacher.id}>
              <th scope="row"><strong>{teacher.fullName}</strong><small>{teacher.staffNo}{teacher.status === "inactive" ? " · inactive" : ""}</small></th>
              <td>{editable ? <select aria-label={`${teacher.fullName} presence`} value={draft.status} onChange={(event) => update(teacher.id, { status: event.target.value as Draft["status"] })}>
                <option value="">Not marked</option>{STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select> : <span>{STATUS.find((option) => option.value === draft.status)?.label ?? "Not marked"}</span>}</td>
              <td>{editable ? <input aria-label={`${teacher.fullName} note`} maxLength={240} value={draft.note} onChange={(event) => update(teacher.id, { note: event.target.value })} placeholder="Optional context" /> : <span>{draft.note || "—"}</span>}</td>
              <td className={styles.recorded}>{attendance ? new Date(attendance.updatedAt).toLocaleString() : "Not recorded"}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className={styles.footer}>
          {canEdit ? <Button onClick={() => void save()} disabled={saving || entries.length === 0} loading={saving}>Save {entries.length} change{entries.length === 1 ? "" : "s"}</Button> : null}
          <div className={styles.pager}>
            <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset((current) => Math.max(0, current - 50))}>← Previous</Button>
            <span>Page {Math.floor(offset / 50) + 1}</span>
            <Button variant="ghost" disabled={page.nextOffset === null} onClick={() => setOffset(page.nextOffset ?? offset)}>Next →</Button>
          </div>
        </div>
      </>}
  </>;
}
