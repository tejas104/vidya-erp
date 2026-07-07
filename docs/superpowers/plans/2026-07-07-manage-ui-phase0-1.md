# Manage UI — Phase 0 + Phase 1 (foundation + academics entry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `/manage` shell and the two academics-entry screens (record attendance, enter marks) so staff can operate the existing academics endpoints from the UI — the first demoable increment of the write-side management UI.

**Architecture:** A `/manage` route-group with a role-gated `ManageNav`, `api.ts` mutation helpers (`post`/`patch`/`put`/`del`) that parse `application/problem+json` into `ApiError`, and a `useMutation` hook for saving/error state. Two client screens drive existing scope-checked/audited academics endpoints; scope-aware pickers reuse `api.dashboard` (the caller's class/subject tiles + section strip). No new backend.

**Tech Stack:** Next.js 16 App Router (client components), TypeScript, existing `apps/web/src/ui/api.ts`, Vitest + React Testing Library, Playwright.

## Global Constraints

- **No new backend, no new dependencies.** UI + api-client layer only over existing endpoints.
- **Demo-impact bar:** clean happy path + key scope/validation/error states; not exhaustive hardening.
- **The UI holds no privileged path.** Every screen relies on server-side scope checks; it only shows what the caller can act on and surfaces `403`/`409`/`422` inline. `401` → redirect `/login`.
- **Reuse existing CSS classes** from `apps/web/app/globals.css`: `.page`, `.page-title`, `.page-lede`, `.eyebrow`, `.card`, `.field` (label+input), `.btn` (+ `.ghost`, `:disabled`), `.section`, `.section-head`, `.state`, `.formerror`, `.chip`, `.num`. No new chart libs.
- **Academics facts (from `packages/modules/academics/src/definition.ts`):**
  - Record attendance: `POST /api/v1/academics/attendance/sessions` body `{ sectionId, heldOn(YYYY-MM-DD), slot(default "day"), academicYear, entries:[{studentId,status}] }`; status ∈ `present|absent|late|excused`; `201`→session, `404` no section, `409` session exists, `422` invalid entries `{message, invalid:[{studentId,reason}]}`.
  - Correct one entry: `PATCH /api/v1/academics/attendance/sessions/{sessionId}/entries/{studentId}` body `{status}`.
  - Existing sessions for a section: `GET /api/v1/academics/sections/{sectionId}/attendance?from&to&limit` → `{sessions:[{id,heldOn,slot,academicYear,counts}]}`.
  - One session with entries: `GET /api/v1/academics/attendance/sessions/{sessionId}` → `{id,sectionId,heldOn,slot,academicYear,takenBy,entries:[{studentId,status}]}`.
  - Assessment kinds are a fixed taxonomy: `exam|quiz|assignment` (ADR-0017).
  - Create assessment: `POST /api/v1/academics/assessments` body `{classId,subjectId,kind,name,academicYear,maxScore,heldOn?}` → `201` assessmentView.
  - Class assessments (subject-filtered by scope): `GET /api/v1/academics/classes/{classId}/assessments?academicYear` → `{assessments:[assessmentView]}`.
  - Enter marks (bulk, all-or-nothing): `PUT /api/v1/academics/assessments/{assessmentId}/marks` body `{entries:[{studentId,score}]}` → `{created,updated,unchanged}`, `422` invalid.
  - Assessment marks: `GET /api/v1/academics/assessments/{assessmentId}/marks` → `{marks:[markView]}`.
- **Scope pickers:** `api.dashboard(year)` returns `tiles` + `names`. A `class` tile = `{type:"class",classId,strip:[{sectionId,name,...}]}`; a `teacher-class` tile = `{type:"teacher-class",classId,subjectId,strip}`. Use these for the section/class/subject pickers (never a hardcoded id).

---

## Task 1: api.ts mutation helpers + academics client methods + `useMutation` hook

**Files:**
- Modify: `apps/web/src/ui/api.ts`
- Create: `apps/web/src/ui/useMutation.ts`
- Test: `apps/web/src/ui/api.test.ts` (create)

**Interfaces:**
- Produces: `post<T>(path, body)`, `patch<T>(path, body)`, `put<T>(path, body)`, `del<T>(path)` (throw `ApiError(status, message)` on non-2xx, parsing problem+json `title`/`message`); `api.sectionRoster(sectionId)`, `api.recordAttendance(body)`, `api.sessionAttendance(sectionId, opts)`, `api.getSession(sessionId)`, `api.correctAttendance(sessionId, studentId, status)`, `api.classAssessments(classId, year)`, `api.createAssessment(body)`, `api.enterMarks(assessmentId, entries)`, `api.assessmentMarks(assessmentId)`; hook `useMutation<TArgs, TResult>(fn)` returning `{ run, phase }` where `phase` is `{name:"idle"|"saving"|"done"}` or `{name:"error", message:string}`.

- [ ] **Step 1: Write the failing test for the mutation helper**

Create `apps/web/src/ui/api.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { api, ApiError } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("api mutation helpers", () => {
  it("recordAttendance POSTs the body and returns the session on 201", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "ses_1", sectionId: "sec_a", heldOn: "2026-06-01", slot: "day", academicYear: "2026-27", takenBy: "u", entries: [] }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = { sectionId: "sec_a", heldOn: "2026-06-01", slot: "day", academicYear: "2026-27", entries: [{ studentId: "stu_1", status: "present" as const }] };
    const res = await api.recordAttendance(body);
    expect(res.id).toBe("ses_1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/academics/attendance/sessions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("parses problem+json into ApiError on 422", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "x", title: "Entries outside the roster", status: 422, requestId: "r" }), { status: 422, headers: { "content-type": "application/problem+json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.recordAttendance({ sectionId: "s", heldOn: "2026-06-01", slot: "day", academicYear: "2026-27", entries: [{ studentId: "x", status: "present" }] }))
      .rejects.toMatchObject({ status: 422, message: "Entries outside the roster" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project ui apps/web/src/ui/api.test.ts`
Expected: FAIL — `api.recordAttendance is not a function`.

- [ ] **Step 3: Add the mutation helpers + academics methods to `api.ts`**

In `apps/web/src/ui/api.ts`, after the existing `get<T>` function (ends ~L133) add:

```ts
type Json = Record<string, unknown> | unknown[];

async function send<T>(method: string, path: string, body?: Json): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { title?: string; message?: string };
    throw new ApiError(response.status, problem.title ?? problem.message ?? `request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
const post = <T>(path: string, body: Json) => send<T>("POST", path, body);
const patch = <T>(path: string, body: Json) => send<T>("PATCH", path, body);
const put = <T>(path: string, body: Json) => send<T>("PUT", path, body);
const del = <T>(path: string) => send<T>("DELETE", path);
```

Then extend the exported `api` object (add these methods inside it, after `distribution`):

```ts
  // people
  sectionRoster: (sectionId: string) =>
    get<{ students: { id: string; fullName: string; admissionNo: string }[] }>(
      `/api/v1/people/sections/${encodeURIComponent(sectionId)}/roster`,
    ),
  // academics — attendance
  recordAttendance: (body: RecordAttendanceBody) =>
    post<SessionView>("/api/v1/academics/attendance/sessions", body),
  sessionAttendance: (sectionId: string, opts: { from?: string; to?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.from) q.set("from", opts.from);
    if (opts.to) q.set("to", opts.to);
    if (opts.limit) q.set("limit", String(opts.limit));
    return get<{ sessions: SessionSummary[] }>(`/api/v1/academics/sections/${encodeURIComponent(sectionId)}/attendance?${q}`);
  },
  getSession: (sessionId: string) =>
    get<SessionView>(`/api/v1/academics/attendance/sessions/${encodeURIComponent(sessionId)}`),
  correctAttendance: (sessionId: string, studentId: string, status: AttendanceStatus) =>
    patch<{ studentId: string; status: AttendanceStatus }>(
      `/api/v1/academics/attendance/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(studentId)}`,
      { status },
    ),
  // academics — marks
  classAssessments: (classId: string, year: string) =>
    get<{ assessments: AssessmentView[] }>(`/api/v1/academics/classes/${encodeURIComponent(classId)}/assessments?academicYear=${year}`),
  createAssessment: (body: CreateAssessmentBody) => post<AssessmentView>("/api/v1/academics/assessments", body),
  enterMarks: (assessmentId: string, entries: { studentId: string; score: number }[]) =>
    put<{ created: number; updated: number; unchanged: number }>(
      `/api/v1/academics/assessments/${encodeURIComponent(assessmentId)}/marks`,
      { entries },
    ),
  assessmentMarks: (assessmentId: string) =>
    get<{ marks: { id: string; assessmentId: string; studentId: string; score: number }[] }>(
      `/api/v1/academics/assessments/${encodeURIComponent(assessmentId)}/marks`,
    ),
```

And add the supporting types near the top type block (after `DistributionResponse`):

```ts
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export interface RecordAttendanceBody {
  sectionId: string; heldOn: string; slot: string; academicYear: string;
  entries: { studentId: string; status: AttendanceStatus }[];
}
export interface SessionView {
  id: string; sectionId: string; heldOn: string; slot: string; academicYear: string; takenBy: string;
  entries: { studentId: string; status: AttendanceStatus }[];
}
export interface SessionSummary {
  id: string; heldOn: string; slot: string; academicYear: string;
  counts: { present: number; absent: number; late: number; excused: number };
}
export type AssessmentKind = "exam" | "quiz" | "assignment";
export interface AssessmentView {
  id: string; classId: string; subjectId: string; kind: AssessmentKind; name: string;
  academicYear: string; maxScore: number; heldOn: string | null;
}
export interface CreateAssessmentBody {
  classId: string; subjectId: string; kind: AssessmentKind; name: string;
  academicYear: string; maxScore: number; heldOn?: string;
}
```

> Confirm the roster response shape against `packages/modules/people/src/api/handlers.ts` (the `people.section-roster` handler) — the field is one of `students`/`roster`; adjust `sectionRoster`'s type + callers to match the real key and student fields (`id`, `fullName`, `admissionNo` per `studentViewSchema`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project ui apps/web/src/ui/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the `useMutation` hook**

Create `apps/web/src/ui/useMutation.ts`:

```ts
"use client";
import { useState } from "react";
import { ApiError } from "./api";

export type MutationPhase =
  | { name: "idle" }
  | { name: "saving" }
  | { name: "done" }
  | { name: "error"; message: string };

export function useMutation<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => Promise<TResult>) {
  const [phase, setPhase] = useState<MutationPhase>({ name: "idle" });
  async function run(...args: TArgs): Promise<TResult | undefined> {
    setPhase({ name: "saving" });
    try {
      const result = await fn(...args);
      setPhase({ name: "done" });
      return result;
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "Something went wrong. Try again.";
      setPhase({ name: "error", message });
      return undefined;
    }
  }
  return { run, phase, reset: () => setPhase({ name: "idle" }) };
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @vidya/web typecheck`
Expected: PASS.

```bash
git add apps/web/src/ui/api.ts apps/web/src/ui/api.test.ts apps/web/src/ui/useMutation.ts
git commit -m "feat(web): api mutation helpers + academics client methods + useMutation hook"
```

---

## Task 2: `/manage` shell — layout + role-gated ManageNav

**Files:**
- Create: `apps/web/app/manage/layout.tsx`
- Create: `apps/web/app/manage/page.tsx`
- Create: `apps/web/src/ui/ManageNav.tsx`
- Test: `apps/web/src/ui/manage-nav.test.tsx` (create)

**Interfaces:**
- Consumes: `api.session()` (returns `{ userId, displayName, roles, grants }`).
- Produces: `<ManageNav roles={Role[]} />` rendering role-appropriate links; `/manage` layout wrapping children with `Masthead` + nav; `/manage` index that links to the caller's screens.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/manage-nav.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ManageNav } from "./ManageNav";

describe("ManageNav (role-gated)", () => {
  it("shows attendance to a class teacher and NOT admin-only links", () => {
    render(<ManageNav roles={["class_teacher"]} />);
    expect(screen.getByRole("link", { name: /attendance/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /users/i })).not.toBeInTheDocument();
  });
  it("shows marks to a teacher", () => {
    render(<ManageNav roles={["teacher"]} />);
    expect(screen.getByRole("link", { name: /marks/i })).toBeInTheDocument();
  });
  it("shows org + users to an admin", () => {
    render(<ManageNav roles={["admin"]} />);
    expect(screen.getByRole("link", { name: /users/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /organisation/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project ui apps/web/src/ui/manage-nav.test.tsx`
Expected: FAIL — cannot find `./ManageNav`.

- [ ] **Step 3: Create `ManageNav`**

Create `apps/web/src/ui/ManageNav.tsx`:

```tsx
"use client";
import type { Role } from "./api";

type Link = { href: string; label: string; roles: Role[] };
const LINKS: Link[] = [
  { href: "/manage/attendance", label: "Attendance", roles: ["class_teacher", "admin"] },
  { href: "/manage/marks", label: "Marks", roles: ["teacher", "admin"] },
  { href: "/manage/org", label: "Organisation", roles: ["admin"] },
  { href: "/manage/students", label: "Students", roles: ["admin"] },
  { href: "/manage/teachers", label: "Teachers", roles: ["admin"] },
  { href: "/manage/users", label: "Users", roles: ["admin"] },
  { href: "/manage/import", label: "Import", roles: ["admin"] },
  { href: "/manage/reports", label: "Reports", roles: ["admin", "principal", "hod", "class_teacher", "teacher"] },
];

export function ManageNav({ roles }: { roles: Role[] }) {
  const visible = LINKS.filter((link) => link.roles.some((r) => roles.includes(r)));
  return (
    <nav aria-label="Manage" style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "12px 0", borderBottom: "1px solid var(--rule)", marginBottom: 20 }}>
      <a className="linklike" href="/dashboard">← Register</a>
      {visible.map((link) => (
        <a key={link.href} className="linklike" href={link.href}>{link.label}</a>
      ))}
    </nav>
  );
}
```

> Note: links only *hint* at what the caller can do; the server still enforces scope on every action. `Role` is exported from `api.ts` (`"admin"|"principal"|"hod"|"class_teacher"|"teacher"`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project ui apps/web/src/ui/manage-nav.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the layout + index page**

Create `apps/web/app/manage/layout.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { api, ApiError, type Session } from "@/ui/api";
import { Masthead } from "@/ui/Masthead";
import { ManageNav } from "@/ui/ManageNav";

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    api.session().then(setSession).catch((e) => {
      if (e instanceof ApiError && e.status === 401) window.location.href = "/login";
    });
  }, []);
  return (
    <>
      <Masthead who={session?.displayName} />
      <main id="main" className="page">
        {session ? <ManageNav roles={session.roles} /> : null}
        {children}
      </main>
    </>
  );
}
```

Create `apps/web/app/manage/page.tsx`:

```tsx
"use client";
export const dynamic = "force-dynamic";
export default function ManageIndex() {
  return (
    <>
      <p className="eyebrow">Manage</p>
      <h1 className="page-title">The office</h1>
      <p className="page-lede">Pick a task from the menu above. You only see the areas your role can act on.</p>
    </>
  );
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @vidya/web typecheck`
Expected: PASS.

```bash
git add apps/web/app/manage/layout.tsx apps/web/app/manage/page.tsx apps/web/src/ui/ManageNav.tsx apps/web/src/ui/manage-nav.test.tsx
git commit -m "feat(web): /manage shell with role-gated nav"
```

---

## Task 3: `/manage/attendance` — record a section's attendance

**Files:**
- Create: `apps/web/app/manage/attendance/page.tsx`
- Test: `apps/web/src/ui/attendance-page.test.tsx` (create)

**Interfaces:**
- Consumes: `api.dashboard`, `api.sectionRoster`, `api.recordAttendance`, `api.sessionAttendance`, `api.getSession`, `api.correctAttendance`, `useMutation`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/attendance-page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AttendancePage from "../../app/manage/attendance/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, dashboard: vi.fn(), sectionRoster: vi.fn(), recordAttendance: vi.fn(), sessionAttendance: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.dashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
    academicYear: "2026-27",
    names: { cls_1: "FY CS", sec_a: "A" },
    tiles: [{ type: "class", classId: "cls_1", attendance: { state: "no-data" }, marks: { state: "no-data" }, atRisk: 0, strip: [{ sectionId: "sec_a", name: "A", days: [] }] }],
  });
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({ students: [{ id: "stu_1", fullName: "Aarav Sharma", admissionNo: "FYCS-001" }] });
  (api.sessionAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [] });
  (api.recordAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ses_1", sectionId: "sec_a", heldOn: "2026-06-01", slot: "day", academicYear: "2026-27", takenBy: "u", entries: [] });
});

describe("attendance entry", () => {
  it("loads the roster for the caller's section and submits present-by-default entries", async () => {
    render(<AttendancePage />);
    // roster appears
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    // submit
    fireEvent.click(screen.getByRole("button", { name: /save attendance/i }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledTimes(1));
    const body = (api.recordAttendance as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.sectionId).toBe("sec_a");
    expect(body.entries).toEqual([{ studentId: "stu_1", status: "present" }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project ui apps/web/src/ui/attendance-page.test.tsx`
Expected: FAIL — cannot find the attendance page module.

- [ ] **Step 3: Implement the attendance page**

Create `apps/web/app/manage/attendance/page.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { api, currentAcademicYear, type AttendanceStatus } from "@/ui/api";
import { useMutation } from "@/ui/useMutation";

export const dynamic = "force-dynamic";
const STATUSES: AttendanceStatus[] = ["present", "absent", "late", "excused"];
type SectionOpt = { sectionId: string; name: string; className: string };
type Student = { id: string; fullName: string; admissionNo: string };

export default function AttendancePage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [sections, setSections] = useState<SectionOpt[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [heldOn, setHeldOn] = useState(today);
  const [roster, setRoster] = useState<Student[]>([]);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const save = useMutation(api.recordAttendance);

  // Populate the section picker from the caller's class/teacher tiles.
  useEffect(() => {
    api.dashboard(year).then((dash) => {
      const opts: SectionOpt[] = [];
      for (const tile of dash.tiles) {
        if (tile.type === "class" || tile.type === "teacher-class") {
          const className = dash.names[tile.classId] ?? tile.classId;
          for (const s of tile.strip) opts.push({ sectionId: s.sectionId, name: s.name, className });
        }
      }
      setSections(opts);
      if (opts[0]) setSectionId(opts[0].sectionId);
    }).catch(() => setSections([]));
  }, [year]);

  // Load the roster when a section is chosen.
  useEffect(() => {
    if (!sectionId) return;
    api.sectionRoster(sectionId).then((r) => {
      setRoster(r.students);
      setMarks(Object.fromEntries(r.students.map((s) => [s.id, "present" as AttendanceStatus])));
    }).catch(() => setRoster([]));
  }, [sectionId]);

  async function submit() {
    await save.run({
      sectionId, heldOn, slot: "day", academicYear: year,
      entries: roster.map((s) => ({ studentId: s.id, status: marks[s.id] ?? "present" })),
    });
  }

  return (
    <>
      <p className="eyebrow">Attendance</p>
      <h1 className="page-title">Record attendance</h1>
      <p className="page-lede">Mark the roster for a section and date. You can only record for a class you teach.</p>

      {sections.length === 0 ? (
        <div className="state"><strong>No sections you can record for.</strong> Attendance is recorded by a class teacher.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
            <label className="field" style={{ minWidth: 220 }}>
              <span>Section</span>
              <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                {sections.map((s) => (<option key={s.sectionId} value={s.sectionId}>{s.className} · {s.name}</option>))}
              </select>
            </label>
            <label className="field">
              <span>Date</span>
              <input type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
            </label>
          </div>

          <div className="card">
            {roster.length === 0 ? <div className="strip-empty">No students enrolled in this section.</div> : roster.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                <span><strong>{s.fullName}</strong> <span className="num" style={{ opacity: 0.6 }}>{s.admissionNo}</span></span>
                <span style={{ display: "flex", gap: 6 }}>
                  {STATUSES.map((st) => (
                    <button key={st} type="button"
                      className={`chip${marks[s.id] === st ? " serious" : ""}`}
                      style={{ cursor: "pointer", textTransform: "capitalize" }}
                      aria-pressed={marks[s.id] === st}
                      onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))}>{st}</button>
                  ))}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 20 }}>
            <button className="btn" type="button" disabled={save.phase.name === "saving" || roster.length === 0} onClick={submit}>
              {save.phase.name === "saving" ? "Saving…" : "Save attendance"}
            </button>
            {save.phase.name === "done" ? <span className="num" style={{ color: "var(--series-1)" }}>Saved. Recompute analytics to see it in the dashboard.</span> : null}
            {save.phase.name === "error" ? <span className="formerror" role="alert" style={{ margin: 0 }}>{save.phase.message}</span> : null}
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project ui apps/web/src/ui/attendance-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @vidya/web typecheck`
Expected: PASS.

```bash
git add apps/web/app/manage/attendance/page.tsx apps/web/src/ui/attendance-page.test.tsx
git commit -m "feat(web): /manage/attendance — record a section's attendance"
```

---

## Task 4: `/manage/marks` — create assessment + enter marks

**Files:**
- Create: `apps/web/app/manage/marks/page.tsx`
- Test: `apps/web/src/ui/marks-page.test.tsx` (create)

**Interfaces:**
- Consumes: `api.dashboard`, `api.classAssessments`, `api.createAssessment`, `api.sectionRoster`, `api.enterMarks`, `api.assessmentMarks`, `useMutation`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/marks-page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import MarksPage from "../../app/manage/marks/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, dashboard: vi.fn(), classAssessments: vi.fn(), createAssessment: vi.fn(), sectionRoster: vi.fn(), enterMarks: vi.fn(), assessmentMarks: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.dashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
    academicYear: "2026-27",
    names: { cls_1: "FY CS", sub_ds: "Data Structures", sec_a: "A" },
    tiles: [{ type: "teacher-class", classId: "cls_1", subjectId: "sub_ds", attendance: { state: "no-data" }, marks: { state: "no-data" }, atRisk: 0, strip: [{ sectionId: "sec_a", name: "A", days: [] }] }],
  });
  (api.classAssessments as ReturnType<typeof vi.fn>).mockResolvedValue({ assessments: [] });
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({ students: [{ id: "stu_1", fullName: "Aarav Sharma", admissionNo: "FYCS-001" }] });
  (api.createAssessment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "as_1", classId: "cls_1", subjectId: "sub_ds", kind: "quiz", name: "Quiz 1", academicYear: "2026-27", maxScore: 10, heldOn: null });
  (api.enterMarks as ReturnType<typeof vi.fn>).mockResolvedValue({ created: 1, updated: 0, unchanged: 0 });
});

describe("marks entry", () => {
  it("creates an assessment for the caller's class+subject", async () => {
    render(<MarksPage />);
    fireEvent.change(await screen.findByLabelText(/assessment name/i), { target: { value: "Quiz 1" } });
    fireEvent.change(screen.getByLabelText(/max score/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /create assessment/i }));
    await waitFor(() => expect(api.createAssessment).toHaveBeenCalledTimes(1));
    const body = (api.createAssessment as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body).toMatchObject({ classId: "cls_1", subjectId: "sub_ds", name: "Quiz 1", maxScore: 10 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project ui apps/web/src/ui/marks-page.test.tsx`
Expected: FAIL — cannot find the marks page module.

- [ ] **Step 3: Implement the marks page**

Create `apps/web/app/manage/marks/page.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { api, currentAcademicYear, type AssessmentKind, type AssessmentView } from "@/ui/api";
import { useMutation } from "@/ui/useMutation";

export const dynamic = "force-dynamic";
const KINDS: AssessmentKind[] = ["quiz", "exam", "assignment"];
type Target = { classId: string; subjectId: string; label: string; sectionId?: string };
type Student = { id: string; fullName: string; admissionNo: string };

export default function MarksPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetIdx, setTargetIdx] = useState(0);
  const [assessments, setAssessments] = useState<AssessmentView[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssessmentKind>("quiz");
  const [maxScore, setMaxScore] = useState("10");
  const [active, setActive] = useState<AssessmentView | null>(null);
  const [roster, setRoster] = useState<Student[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const create = useMutation(api.createAssessment);
  const enter = useMutation((assessmentId: string, entries: { studentId: string; score: number }[]) => api.enterMarks(assessmentId, entries));

  useEffect(() => {
    api.dashboard(year).then((dash) => {
      const t: Target[] = [];
      for (const tile of dash.tiles) {
        if (tile.type === "teacher-class") {
          t.push({ classId: tile.classId, subjectId: tile.subjectId, sectionId: tile.strip[0]?.sectionId, label: `${dash.names[tile.classId] ?? tile.classId} · ${dash.names[tile.subjectId] ?? tile.subjectId}` });
        }
      }
      setTargets(t);
    }).catch(() => setTargets([]));
  }, [year]);

  const target = targets[targetIdx];
  useEffect(() => {
    if (!target) return;
    api.classAssessments(target.classId, year).then((r) => setAssessments(r.assessments.filter((a) => a.subjectId === target.subjectId))).catch(() => setAssessments([]));
    if (target.sectionId) api.sectionRoster(target.sectionId).then((r) => setRoster(r.students)).catch(() => setRoster([]));
  }, [targetIdx, target, year, create.phase.name]);

  async function onCreate() {
    if (!target) return;
    const created = await create.run({ classId: target.classId, subjectId: target.subjectId, kind, name, academicYear: year, maxScore: Number(maxScore) });
    if (created) { setActive(created); setName(""); setScores({}); }
  }
  async function onEnter() {
    if (!active) return;
    const entries = roster.filter((s) => scores[s.id] !== undefined && scores[s.id] !== "").map((s) => ({ studentId: s.id, score: Number(scores[s.id]) }));
    if (entries.length > 0) await enter.run(active.id, entries);
  }

  if (targets.length === 0) {
    return (<><p className="eyebrow">Marks</p><h1 className="page-title">Enter marks</h1>
      <div className="state"><strong>No subject you teach.</strong> Marks are entered by a subject teacher.</div></>);
  }

  return (
    <>
      <p className="eyebrow">Marks</p>
      <h1 className="page-title">Enter marks</h1>
      <p className="page-lede">Create an assessment for your subject, then enter each student's score.</p>

      <label className="field" style={{ maxWidth: 360 }}>
        <span>Class · subject</span>
        <select value={targetIdx} onChange={(e) => { setTargetIdx(Number(e.target.value)); setActive(null); }}>
          {targets.map((t, i) => (<option key={`${t.classId}-${t.subjectId}`} value={i}>{t.label}</option>))}
        </select>
      </label>

      <section className="section" aria-label="New assessment">
        <div className="section-head"><h2>New assessment</h2></div>
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label className="field"><span>Assessment name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><span>Kind</span><select value={kind} onChange={(e) => setKind(e.target.value as AssessmentKind)}>{KINDS.map((k) => (<option key={k} value={k}>{k}</option>))}</select></label>
            <label className="field"><span>Max score</span><input type="number" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} /></label>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="btn" type="button" disabled={create.phase.name === "saving" || name.trim() === ""} onClick={onCreate}>
              {create.phase.name === "saving" ? "Creating…" : "Create assessment"}
            </button>
            {create.phase.name === "error" ? <span className="formerror" role="alert" style={{ margin: 0 }}>{create.phase.message}</span> : null}
          </div>
        </div>
      </section>

      {active ? (
        <section className="section" aria-label="Enter scores">
          <div className="section-head"><h2>{active.name} · out of {active.maxScore}</h2></div>
          <div className="card">
            {roster.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                <span><strong>{s.fullName}</strong> <span className="num" style={{ opacity: 0.6 }}>{s.admissionNo}</span></span>
                <input type="number" min={0} max={active.maxScore} value={scores[s.id] ?? ""} style={{ width: 90 }}
                  onChange={(e) => setScores((sc) => ({ ...sc, [s.id]: e.target.value }))} aria-label={`score for ${s.fullName}`} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
            <button className="btn" type="button" disabled={enter.phase.name === "saving"} onClick={onEnter}>
              {enter.phase.name === "saving" ? "Saving…" : "Save marks"}
            </button>
            {enter.phase.name === "done" ? <span className="num" style={{ color: "var(--series-1)" }}>Marks saved.</span> : null}
            {enter.phase.name === "error" ? <span className="formerror" role="alert" style={{ margin: 0 }}>{enter.phase.message}</span> : null}
          </div>
        </section>
      ) : (
        <section className="section" aria-label="Existing assessments">
          <div className="section-head"><h2>Existing assessments</h2><span className="stat-sub num">{assessments.length}</span></div>
          <div className="card">
            {assessments.length === 0 ? <div className="strip-empty">None yet — create one above.</div> : assessments.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                <span><strong>{a.name}</strong> <span className="num" style={{ opacity: 0.6 }}>{a.kind} · /{a.maxScore}</span></span>
                <button className="btn ghost" type="button" onClick={() => setActive(a)}>Enter scores</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project ui apps/web/src/ui/marks-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + full UI suite + commit**

Run: `pnpm --filter @vidya/web typecheck && pnpm test:ui`
Expected: PASS (all UI tests).

```bash
git add apps/web/app/manage/marks/page.tsx apps/web/src/ui/marks-page.test.tsx
git commit -m "feat(web): /manage/marks — create assessment + enter marks"
```

---

## Task 5: Live verification (Playwright, per role)

**Files:**
- Use the run-session driver pattern (`createRequire` for `playwright` from the npx cache); write a `manage-drive.mjs` in the scratchpad.

- [ ] **Step 1: Ensure the stack is running with this code**

The web dev server hot-reloads app/ changes; no restart needed for these client screens. Confirm web + worker + infra are up (`curl -s http://localhost:3000/api/v1/system/health`). If web is down, relaunch: `set -a && source .env && set +a && apps/web/node_modules/.bin/next dev apps/web -p 3000` (background).

- [ ] **Step 2: Drive attendance as the class teacher**

Log in as `demo-ct-fycs` / `demo-teacher-pass-2026!`, go to `/manage/attendance`, pick the section, toggle a couple of students to absent, click "Save attendance". Screenshot. Expect either a success note or a `409` "already exists" inline (the seed already recorded June–July; pick a fresh date like `2026-07-07`).

- [ ] **Step 3: Drive marks as the subject teacher**

Log in as `demo-teacher-ds` / `demo-teacher-pass-2026!`, go to `/manage/marks`, create an assessment ("Pop Quiz", quiz, max 10), enter a score for each student, click "Save marks". Screenshot. Expect "Marks saved."

- [ ] **Step 4: Confirm the loop closes**

As `demo-admin`, `POST /api/v1/analytics/recompute {academicYear:"2026-27"}`, then open `/dashboard` as the teacher — the new data is reflected. Screenshot.

- [ ] **Step 5: Look at every screenshot**

Confirm the pickers are populated from scope, the roster grids render, saves succeed (or show the designed inline error), and the nav shows only role-appropriate links. Note any issue for a fix task.

---

## Self-Review

- **Spec coverage (Phase 0 + Phase 1 only):** shell + nav → Task 2; `api.ts` mutations + `useMutation` → Task 1; `/manage/attendance` → Task 3; `/manage/marks` → Task 4; scope-aware pickers via `api.dashboard` → Tasks 3-4; error/withheld handling → per-screen `useMutation` phases; verification → Task 5. Areas B/C/D (org/people, identity, import/reports) are **out of this plan** — each gets its own plan next (noted to the user).
- **YAGNI deviation from spec:** the spec listed `DataTable`/`ConfirmDialog` under Phase 0; this plan builds only what Phase 1 uses (nav, api mutations, `useMutation`) and defers those primitives to the phase that first needs them (Phase 2 org admin). Intentional.
- **Placeholder scan:** one explicit confirm-the-shape note (roster response key) with the exact file to check — same pattern that worked in Round 1; not a blind placeholder.
- **Type consistency:** `AttendanceStatus`, `SessionView`, `AssessmentView`, `AssessmentKind`, `RecordAttendanceBody`, `CreateAssessmentBody` are defined in Task 1 and used verbatim in Tasks 3-4; `useMutation` signature matches its uses.
- **Known demo caveat:** the seed already recorded attendance for June–July, so re-recording the same section/date returns `409` (surfaced inline) — verification uses a fresh date.
```
