"use client";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type RosterCard,
  type StudentStatus,
  type StudentView,
  type TtToday,
} from "@/ui/api";
import { RingStat } from "@/ui/RingStat";
import { StudentCard, type StudentFlags } from "@/ui/StudentCard";
import { TodayTimeline } from "@/ui/TodayTimeline";
import { StudentDrawer, type DrawerStudent } from "@/ui/StudentDrawer";
import { Skeleton } from "@/ui/Skeleton";
import { EmptyState } from "@/ui/EmptyState";
import { Modal } from "@/ui/Modal";
import { Field } from "@/ui/Field";
import { Button } from "@/ui/Button";
import { useToast } from "@/ui/Toast";

export const dynamic = "force-dynamic";

const SHORT = 75;
const AVATARS = [
  "linear-gradient(140deg,#6B7BFF,#4A5BD8)",
  "linear-gradient(140deg,#F59E0B,#D97706)",
  "linear-gradient(140deg,#10B981,#059669)",
  "linear-gradient(140deg,#8B5CF6,#7C3AED)",
  "linear-gradient(140deg,#EC4899,#DB2777)",
  "linear-gradient(140deg,#06B6D4,#0891B2)",
];
const initials = (name: string): string => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] : "")).toUpperCase() || "·";
};

type ClassOpt = {
  sectionId: string;
  sectionName: string;
  className: string;
  subjectId?: string;
  subjectName?: string;
};
type Card = { student: StudentView; att: RosterCard | null; idx: number };
type Filter = "all" | "short" | "backlog" | "fees" | "yb";

function flagsFor(c: Card): StudentFlags {
  const pct = c.att?.pct ?? null;
  return {
    short: pct !== null && pct < SHORT,
    backlog: c.student.status === "backlog",
    yb: c.student.status === "year_back",
    fees: false, // fees-per-student for the workspace is not wired yet
  };
}

export default function ClassWorkspacePage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const toast = useToast();
  const [roles, setRoles] = useState<string[]>([]);
  const [opts, setOpts] = useState<ClassOpt[]>([]);
  const [pick, setPick] = useState(0);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [today, setToday] = useState<TtToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<DrawerStudent | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [collegeId, setCollegeId] = useState("");
  const [adding, setAdding] = useState(false);
  const [newAdm, setNewAdm] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  // SCOPE STUB — real rule is "holds a class_teacher grant on THIS section",
  // enforced server-side. Author that check; this role flag is a placeholder.
  const canManage = roles.includes("class_teacher") || roles.includes("admin");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.session();
        if (!alive) return;
        setRoles([...me.roles]);
        const dash = await api.dashboard(year);
        if (!alive) return;
        const list: ClassOpt[] = [];
        for (const tile of dash.tiles) {
          if (tile.type !== "class" && tile.type !== "teacher-class") continue;
          const className = dash.names[tile.classId] ?? tile.classId;
          const subjectId = tile.type === "teacher-class" ? tile.subjectId : undefined;
          for (const s of tile.strip) {
            list.push({
              sectionId: s.sectionId,
              sectionName: s.name,
              className,
              subjectId,
              subjectName: subjectId ? dash.names[subjectId] : undefined,
            });
          }
        }
        setOpts(list);
        api.ttMyToday(year).then((t) => alive && setToday(t)).catch(() => undefined);
        api.colleges().then((c) => alive && setCollegeId(c.colleges[0]?.id ?? "")).catch(() => undefined);
      } catch {
        if (alive) setError("Couldn't load your classes.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [year]);

  const opt = opts[pick];

  useEffect(() => {
    if (!opt) return;
    let alive = true;
    setCards(null);
    setError(null);
    Promise.all([
      api.sectionRoster(opt.sectionId),
      api.rosterAttendance(opt.sectionId, { academicYear: year, subjectId: opt.subjectId }),
    ])
      .then(([roster, att]) => {
        if (!alive) return;
        const byId = new Map(att.cards.map((c) => [c.studentId, c]));
        setCards(roster.students.map((student, idx) => ({ student, att: byId.get(student.id) ?? null, idx })));
      })
      .catch(() => alive && setError("Couldn't load this roster."));
    return () => {
      alive = false;
    };
  }, [opt, year, reloadTick]);

  async function setStudentStatus(status: string) {
    if (!open) return;
    try {
      await api.updateStudent(open.studentId, { status: status as StudentStatus });
      toast.show(`${open.name} → ${status}.`, "good");
      setOpen((cur) => (cur && cur.studentId === open.studentId ? { ...cur, status } : cur));
      setReloadTick((n) => n + 1); // refresh cards/flags
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't change status.", "danger");
    }
  }

  async function addStudent() {
    if (!opt || collegeId === "" || newAdm.trim() === "" || newName.trim() === "") return;
    setSaving(true);
    try {
      // sectionId scopes the create to this section — a class teacher may add
      // into their own; the server 403s for any other (2.4).
      await api.createStudent({
        collegeId,
        admissionNo: newAdm.trim(),
        fullName: newName.trim(),
        sectionId: opt.sectionId,
        academicYear: year,
      });
      toast.show(`${newName.trim()} added to ${opt.className} · ${opt.sectionName}.`, "good");
      setAdding(false);
      setNewAdm("");
      setNewName("");
      setReloadTick((n) => n + 1);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't add the student.", "danger");
    } finally {
      setSaving(false);
    }
  }

  // --- rings (class-level, derived from the roster) ---
  const withPct = (cards ?? []).filter((c) => c.att?.pct != null);
  const avgAtt = withPct.length ? Math.round(withPct.reduce((s, c) => s + (c.att!.pct ?? 0), 0) / withPct.length) : 0;
  const shortN = (cards ?? []).filter((c) => (c.att?.pct ?? 100) < SHORT).length;
  const backlogN = (cards ?? []).filter((c) => c.student.status === "backlog").length;
  const total = cards?.length ?? 0;

  const visible = (cards ?? []).filter((c) => {
    const f = flagsFor(c);
    const passFilter =
      filter === "all" ||
      (filter === "short" && f.short) ||
      (filter === "backlog" && f.backlog) ||
      (filter === "yb" && f.yb) ||
      (filter === "fees" && f.fees);
    const q = query.trim().toLowerCase();
    const passQuery = !q || c.student.fullName.toLowerCase().includes(q) || c.student.admissionNo.toLowerCase().includes(q);
    return passFilter && passQuery;
  });

  async function openCard(c: Card) {
    const f = flagsFor(c);
    const base: DrawerStudent = {
      studentId: c.student.id,
      initials: initials(c.student.fullName),
      gradient: AVATARS[c.idx % AVATARS.length]!,
      rollNo: c.student.admissionNo,
      name: c.student.fullName,
      section: `${opt?.className ?? ""} · ${opt?.sectionName ?? ""}`,
      status: c.student.status,
      pct: c.att?.pct ?? null,
      attended: c.att?.attended ?? 0,
      total: c.att?.total ?? 0,
      lastMark: null,
      backlogs: c.student.status === "backlog" ? 1 : 0,
      flags: f,
      phone: c.student.phone,
      guardianName: c.student.guardianName,
      guardianPhone: c.student.guardianPhone,
      dob: c.student.dob,
    };
    setOpen(base);
    // last mark on demand (subject-scoped by the caller's grant)
    api
      .studentMarks(c.student.id, year)
      .then((r) => {
        const last = r.marks[r.marks.length - 1];
        if (last) {
          setOpen((cur) =>
            cur && cur.studentId === base.studentId
              ? { ...cur, lastMark: `${last.assessment.name} · ${last.mark.score}/${last.assessment.maxScore}` }
              : cur,
          );
        }
      })
      .catch(() => undefined);
  }

  if (error && opts.length === 0) return <EmptyState title="Couldn't load." message={error} />;

  const chip = (f: Filter, label: string, n: number) => (
    <button type="button" className={`cw-chip${filter === f ? " on" : ""}`} onClick={() => setFilter(f)}>
      {label} <span className="c">{n}</span>
    </button>
  );

  return (
    <>
      {opts.length === 0 ? (
        <div className="state">
          <strong>No classes to show yet.</strong> A class or subject assignment brings your workspace here.
        </div>
      ) : (
        <div className="cw-grid">
          <div className="cw-main">
            <label className="field" style={{ maxWidth: 380, marginBottom: 16 }}>
              <span>Class</span>
              <select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
                {opts.map((o, i) => (
                  <option key={o.sectionId + (o.subjectId ?? "")} value={i}>
                    {o.className} · {o.sectionName}
                    {o.subjectName ? ` · ${o.subjectName}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="cw-hero">
              <div className="cw-hero-eyebrow">
                Class workspace{total ? ` · ${total} students` : ""}
              </div>
              <h1>
                {opt?.className} · {opt?.sectionName}
              </h1>
              <p>
                {opt?.subjectName ? `You teach ${opt.subjectName} here. ` : ""}
                {cards === null
                  ? "Loading the roster…"
                  : `${shortN} short of 75%${backlogN ? ` · ${backlogN} in backlog` : ""}.`}
              </p>
              <div className="cw-hero-cta">
                <a
                  className="cw-hbtn"
                  href={`/manage/attendance?sectionId=${encodeURIComponent(opt?.sectionId ?? "")}${
                    opt?.subjectId ? `&subjectId=${encodeURIComponent(opt.subjectId)}` : ""
                  }`}
                >
                  Mark attendance
                </a>
                <button className="cw-hbtn ghost" disabled title="corrections queue not wired yet">
                  Review corrections
                </button>
              </div>
            </div>

            <div className="cw-rings">
              <RingStat
                pct={avgAtt}
                display={`${avgAtt}%`}
                label="Class attendance"
                value={`${avgAtt}%`}
                sub={opt?.subjectName ?? "all subjects"}
                tone={avgAtt < 75 ? "warn" : "good"}
              />
              <RingStat
                pct={total ? (shortN / total) * 100 : 0}
                display={`${shortN}`}
                label="Short of 75%"
                value={`${shortN} / ${total}`}
                sub="eligibility risk"
                tone="bad"
              />
              <RingStat
                pct={total ? (backlogN / total) * 100 : 0}
                display={`${backlogN}`}
                label="In backlog"
                value={`${backlogN}`}
                sub="ATKT · lifecycle"
                tone="warn"
              />
              <RingStat
                pct={0}
                display="—"
                label="Fees pending"
                value="—"
                sub="not wired"
                tone="brand"
              />
            </div>

            <div className="cw-toolbar">
              <input
                className="cw-search"
                placeholder="Search name or roll no…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search students"
              />
              {chip("all", "All", total)}
              {chip("short", "Short", shortN)}
              {chip("backlog", "Backlog", backlogN)}
              {chip("yb", "Year-back", (cards ?? []).filter((c) => c.student.status === "year_back").length)}
              {canManage ? (
                <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}>
                  + Add student
                </button>
              ) : null}
            </div>

            {cards === null ? (
              <Skeleton lines={4} />
            ) : error ? (
              <div className="state"><strong>{error}</strong> Try again shortly.</div>
            ) : visible.length === 0 ? (
              <div className="state"><strong>No students match.</strong> Try a different filter or clear the search.</div>
            ) : (
              <div className="cw-cards">
                {visible.map((c) => (
                  <StudentCard
                    key={c.student.id}
                    initials={initials(c.student.fullName)}
                    gradient={AVATARS[c.idx % AVATARS.length]!}
                    rollNo={c.student.admissionNo}
                    name={c.student.fullName}
                    pct={c.att?.pct ?? null}
                    flags={flagsFor(c)}
                    onOpen={() => void openCard(c)}
                  />
                ))}
              </div>
            )}
          </div>

          <aside className="cw-aside">
            <div className="cw-panel">
              <div className="cw-panel-h">
                <h2>Today</h2>
                <span className="hint">{today ? `${today.entries.length} periods` : ""}</span>
              </div>
              {today === null ? <Skeleton lines={3} /> : <TodayTimeline today={today} />}
            </div>
          </aside>
        </div>
      )}

      <StudentDrawer
        student={open}
        canManage={canManage}
        onClose={() => setOpen(null)}
        onSetStatus={(status) => void setStudentStatus(status)}
      />

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={`Add student — ${opt?.className ?? ""} · ${opt?.sectionName ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={() => void addStudent()} loading={saving} disabled={newAdm.trim() === "" || newName.trim() === ""}>
              Add student
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
            Added straight into your section and enrolled for {year}. The record is audited and never deleted.
          </p>
          <Field label="Admission no." htmlFor="add-adm">
            <input id="add-adm" value={newAdm} onChange={(e) => setNewAdm(e.target.value)} placeholder="e.g. FYCS-015" />
          </Field>
          <Field label="Full name" htmlFor="add-name">
            <input id="add-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Student name" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
