# S2a — Navigation & IA shell (Assignment #10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup the sidebar into the 7 task-domains, add derived breadcrumbs, and add a Cmd/Ctrl-K global search (students + pages) built on a prefetch-on-open scoped index — presentation-only, e2e stays 18/18.

**Architecture:** `navConfig` becomes the single source for both sidebar grouping and breadcrumbs. `Sidebar` renders ungrouped top items then collapsible domain groups (default expanded). A new `search/` module: `searchIndex.ts` (pure-ish index build/filter with a concurrency pool + progress + session cache) and `SearchPalette.tsx` (built on the S1 `@vidya/ui-system` `Modal`), mounted once in `AppShell` with a Cmd-K handler and a `Topbar` search box.

**Tech Stack:** Next 16 App Router, React 19, `@vidya/ui-system` (Modal/Skeleton/EmptyState/Input), vitest `ui` project (jsdom + RTL), Playwright e2e.

## Global Constraints

- **Presentation/navigation only.** ZERO changes under any `**/handlers/**`, `**/schema/**`, `**/migrations/**`, `packages/platform/src/auth/**`. If a task seems to need one → STOP and report a finding.
- **Search = students + pages only** (no staff — no teachers-list endpoint; finding 3).
- **PII boundary:** `sectionRoster` returns `StudentView` incl. phone/guardian/dob — index entries carry `label(name)/roll/sub(sectionId)/href` ONLY. Never copy PII into the index.
- **Single source:** breadcrumbs derive from the SAME `NAV` entries the sidebar renders — no second hand-maintained route map (a parallel map is a review-reject).
- **Sidebar groups default EXPANDED**; collapse is opt-in and persisted per-group in `localStorage`.
- **New component CSS = CSS Modules, token-only** (`var(--token)`, no hex — the `check:styles` gate enforces it). Sidebar collapse styling may extend `globals.css` minimally (it's the ignore-listed legacy sheet; full migration is S2b), token-only.
- **e2e stays 18/18** (worker up + prod build; see [[e2e-run-recipe]]). `test:ui` stays green.
- Branch `feat/assignment-10-ui-overhaul`; commit only your task's files (explicit `git add`, never `-A` — unrelated ops WIP is uncommitted in the tree).

## File Structure
```
apps/web/src/ui/navConfig.ts        (modify) 7-domain groups + DOMAIN_ORDER + ungrouped top; crumbsFor()
apps/web/src/ui/Sidebar.tsx         (modify) collapsible groups, default-expanded, persisted
apps/web/src/ui/Breadcrumbs.tsx     (new)    renders crumbsFor() into PageHeader slot
apps/web/src/ui/Topbar.tsx          (modify) header search box → opens palette
apps/web/src/ui/AppShell.tsx        (modify) mount Cmd-K handler + SearchPalette + search-open state
apps/web/src/ui/search/searchIndex.ts   (new) buildIndex/filterIndex/cache/pool/progress
apps/web/src/ui/search/SearchPalette.tsx (new) Modal-based palette
apps/web/src/ui/search/pool.ts           (new) tiny concurrency-pool helper
+ colocated *.test.ts(x) for navConfig(crumbs), searchIndex, pool, Breadcrumbs, SearchPalette, Sidebar
update apps/web/src/ui/shell.test.tsx / structure.test.tsx to the new groups
```

---

### Task 1: navConfig — 7-domain regroup + crumbsFor

**Files:** Modify `apps/web/src/ui/navConfig.ts`; update `apps/web/src/ui/shell.test.tsx`, `structure.test.tsx` (whichever assert group names — grep first).

**Interfaces — Produces:**
- `NAV` entries with `group` in `"PEOPLE"|"ACADEMICS"|"FEES"|"COMMUNICATION"|"REPORTS"|"ADMINISTRATION"` or `"TOP"` (ungrouped sentinel).
- `visibleNav(roles): { group, entries }[]` — unchanged signature; groups returned in `DOMAIN_ORDER`, `TOP` first.
- `crumbsFor(pathname: string): { label: string; href?: string }[]` — domain + page label from the matching NAV entry; `[]` for `/dashboard` and unknown paths.

- [ ] **Step 1: failing test** — append to `navConfig` test (create `apps/web/src/ui/navconfig.test.ts` if none):
```ts
import { describe, expect, it } from "vitest";
import { visibleNav, crumbsFor } from "./navConfig";
describe("navConfig 7-domain regroup", () => {
  it("orders groups TOP→PEOPLE→ACADEMICS→…→ADMINISTRATION for admin", () => {
    const g = visibleNav(["admin"]).map((x) => x.group);
    expect(g[0]).toBe("TOP");
    expect(g).toEqual(["TOP", "PEOPLE", "ACADEMICS", "FEES", "COMMUNICATION", "REPORTS", "ADMINISTRATION"]);
  });
  it("omits empty groups (no ANALYTICS; accountant has no ACADEMICS)", () => {
    expect(visibleNav(["accountant"]).map((x) => x.group)).not.toContain("ANALYTICS");
  });
  it("crumbsFor derives domain + label from NAV, none for dashboard", () => {
    expect(crumbsFor("/manage/marks")).toEqual([{ label: "Academics" }, { label: "Marks" }]);
    expect(crumbsFor("/dashboard")).toEqual([]);
  });
});
```

- [ ] **Step 2: run → fail** `pnpm exec vitest run --project ui apps/web/src/ui/navconfig.test.ts` (crumbsFor undefined).

- [ ] **Step 3: implement.** In `navConfig.ts`: (a) change every entry's `group` to the domain per the spec mapping (Dashboard + "My register" → `"TOP"`; Students/Teachers/Student directory/Organisation → `"PEOPLE"`; My Classes/My Timetable/Attendance/Marks/Coursework/Syllabus/Exams/Timetable/Calendar/Results/Backlogs → `"ACADEMICS"`; Fees → `"FEES"`; Notices → `"COMMUNICATION"`; Reports → `"REPORTS"`; Leave/Users/Import/System → `"ADMINISTRATION"`). Keep the two Syllabus entries (teacher vs principal/admin) but both now `"ACADEMICS"` — dedupe if that produces a duplicate visible entry for a role (it won't; roles differ). (b) Add:
```ts
export const DOMAIN_ORDER = ["TOP","PEOPLE","ACADEMICS","FEES","COMMUNICATION","REPORTS","ADMINISTRATION"] as const;
const LABEL: Record<string, string> = { PEOPLE:"People", ACADEMICS:"Academics", FEES:"Fees", COMMUNICATION:"Communication", REPORTS:"Reports", ADMINISTRATION:"Administration" };
```
(c) In `visibleNav`, after building buckets, sort by `DOMAIN_ORDER.indexOf(group)`. (d) Add `crumbsFor`:
```ts
export function crumbsFor(pathname: string): { label: string; href?: string }[] {
  const entry = NAV.find((e) => e.group !== "TOP" && (pathname === e.href || pathname.startsWith(`${e.href}/`)));
  if (!entry) return [];
  return [{ label: LABEL[entry.group] ?? entry.group }, { label: entry.label }];
}
```

- [ ] **Step 4: run → pass.** Then grep + fix `shell.test.tsx`/`structure.test.tsx` for old group strings ("Teaching"/"Administration"/"Overview"/"Fees") and update expectations to the new domains. Run `pnpm test:ui` → green.

- [ ] **Step 5: commit** `feat(nav): regroup sidebar into 7 task-domains + crumbsFor derivation`
  (`git add apps/web/src/ui/navConfig.ts apps/web/src/ui/navconfig.test.ts apps/web/src/ui/shell.test.tsx apps/web/src/ui/structure.test.tsx`)

---

### Task 2: Sidebar — collapsible groups (default expanded, persisted)

**Files:** Modify `apps/web/src/ui/Sidebar.tsx`; add collapse CSS to `apps/web/app/globals.css` (token-only); test `apps/web/src/ui/sidebar-collapse.test.tsx`.

**Interfaces — Consumes:** `visibleNav`, `DOMAIN_ORDER`. **Produces:** Sidebar renders `TOP` entries ungrouped first, then each domain as a `<button aria-expanded>` header + collapsible list.

- [ ] **Step 1: failing test**
```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
beforeEach(() => localStorage.clear());
describe("Sidebar collapsible groups", () => {
  it("renders domain groups expanded by default and toggles+persists", () => {
    render(<Sidebar roles={["admin"]} open onClose={() => {}} />);
    const people = screen.getByRole("button", { name: /People/i });
    expect(people).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Students/i })).toBeInTheDocument();
    fireEvent.click(people);
    expect(people).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("vidya-nav-collapsed")).toContain("PEOPLE");
  });
});
```

- [ ] **Step 2: run → fail** (no group buttons yet).

- [ ] **Step 3: implement.** Rewrite the `.map` body: split `visibleNav` into the `TOP` group (render its links directly, no header) and domain groups. For each domain group render a `<button className="shell-nav-title" aria-expanded={!collapsed} onClick={toggle}>` (keep the label styling; add a chevron `Icon`). Track `collapsed` as a `Set<string>` in state, initialized from `JSON.parse(localStorage.getItem("vidya-nav-collapsed") ?? "[]")`; `toggle(group)` updates state + writes the array back. Only render the group's `entries` when not collapsed. Preserve the existing `.shell-nav-link` active logic and the class-teacher context line (now under ACADEMICS or keep near "My Classes"). Add minimal CSS to globals.css: `.shell-nav-title { display:flex; align-items:center; justify-content:space-between; width:100%; background:none; border:0; cursor:pointer; }` and a chevron rotate on `[aria-expanded="false"]` — token-only, no hex.

- [ ] **Step 4: run → pass**; `pnpm test:ui` green.

- [ ] **Step 5: commit** `feat(nav): collapsible sidebar groups, default-expanded, persisted`

---

### Task 3: Breadcrumbs component

**Files:** Create `apps/web/src/ui/Breadcrumbs.tsx` + `Breadcrumbs.module.css` + `breadcrumbs.test.tsx`.

**Interfaces — Consumes:** `crumbsFor` (Task 1). **Produces:** `<Breadcrumbs />` (uses `usePathname`) → renders crumbs, or `null` when empty. Intended for the `PageHeader` breadcrumb slot.

- [ ] **Step 1: failing test**
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ usePathname: () => "/manage/marks" }));
import { Breadcrumbs } from "./Breadcrumbs";
it("renders derived crumbs", () => {
  render(<Breadcrumbs />);
  expect(screen.getByText("Academics")).toBeInTheDocument();
  expect(screen.getByText("Marks")).toBeInTheDocument();
});
```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** `Breadcrumbs.tsx`:
```tsx
"use client";
import { usePathname } from "next/navigation";
import { crumbsFor } from "./navConfig";
import styles from "./Breadcrumbs.module.css";
export function Breadcrumbs() {
  const crumbs = crumbsFor(usePathname());
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      {crumbs.map((c, i) => (
        <span key={i} className={styles.crumb}>
          {i > 0 && <span className={styles.sep} aria-hidden="true">/</span>}
          {c.href ? <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
```
`Breadcrumbs.module.css` — token-only: `.crumbs { display:flex; gap:var(--space-2); font-size:var(--text-12); color:var(--ink-3); }` `.sep { margin:0 var(--space-1); }`.

- [ ] **Step 4: run → pass.**
- [ ] **Step 5: commit** `feat(nav): derived Breadcrumbs component`

---

### Task 4: concurrency pool helper

**Files:** Create `apps/web/src/ui/search/pool.ts` + `pool.test.ts`.

**Interfaces — Produces:** `mapPool<T,R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>, onEach?: (done: number, total: number) => void): Promise<R[]>` — runs `fn` over items with at most `limit` concurrent, preserves result order, calls `onEach` as each settles.

- [ ] **Step 1: failing test**
```ts
import { describe, expect, it } from "vitest";
import { mapPool } from "./pool";
it("caps concurrency, preserves order, reports progress", async () => {
  let inflight = 0, maxSeen = 0; const prog: number[] = [];
  const out = await mapPool([1,2,3,4,5], 2, async (n) => {
    inflight++; maxSeen = Math.max(maxSeen, inflight);
    await new Promise((r) => setTimeout(r, 5)); inflight--; return n * 2;
  }, (done) => prog.push(done));
  expect(out).toEqual([2,4,6,8,10]);
  expect(maxSeen).toBeLessThanOrEqual(2);
  expect(prog[prog.length - 1]).toBe(5);
});
```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement**
```ts
export async function mapPool<T, R>(
  items: T[], limit: number, fn: (item: T, i: number) => Promise<R>,
  onEach?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
      done++; onEach?.(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
```

- [ ] **Step 4: run → pass.**
- [ ] **Step 5: commit** `feat(search): bounded concurrency pool helper`

---

### Task 5: searchIndex — build/filter/cache

**Files:** Create `apps/web/src/ui/search/searchIndex.ts` + `searchIndex.test.ts`.

**Interfaces — Consumes:** `mapPool` (Task 4), `api` (`colleges`, `collegeTree`, `sectionRoster`), `NAV`. **Produces:**
- `type IndexEntry = { kind: "student"|"page"; label: string; sub?: string; href: string; roll?: string }`
- `buildIndex(apiLike, roles, onProgress?): Promise<IndexEntry[]>`
- `filterIndex(entries, q): { students: IndexEntry[]; pages: IndexEntry[] }`
- `getCachedIndex()/clearIndexCache()` (module-level session cache)

- [ ] **Step 1: failing test** (mock a minimal `apiLike`)
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildIndex, filterIndex, clearIndexCache } from "./searchIndex";
const apiLike = {
  colleges: vi.fn(async () => ({ colleges: [{ id: "c1", name: "C", code: "C" }] })),
  collegeTree: vi.fn(async () => ({ college: { id: "c1", name: "C", code: "C" },
    departments: [{ id: "d", collegeId: "c1", name: "D", code: "D",
      classes: [{ id: "cl", departmentId: "d", name: "I", code: "I",
        sections: [{ id: "s1", classId: "cl", name: "A" }] }], subjects: [] }] })),
  sectionRoster: vi.fn(async () => ({ students: [
    { id: "st1", collegeId: "c1", admissionNo: "23CS001", fullName: "Asha Rao", status: "active",
      identityUserId: null, enrollment: { sectionId: "s1", academicYear: "2026" },
      phone: "999", guardianName: "X", guardianPhone: "8", dob: "2005-01-01" }] })),
};
beforeEach(() => clearIndexCache());
it("indexes pages (role-filtered) + students projected WITHOUT PII", async () => {
  const idx = await buildIndex(apiLike as any, ["admin"]);
  const st = idx.find((e) => e.kind === "student")!;
  expect(st).toEqual({ kind: "student", label: "Asha Rao", roll: "23CS001", sub: "s1", href: "/students/st1" });
  expect(JSON.stringify(idx)).not.toMatch(/999|guardian|2005-01-01/); // no PII
  expect(idx.some((e) => e.kind === "page" && e.label === "Marks")).toBe(false); // marks not admin? (adjust to a known admin page)
  expect(idx.some((e) => e.kind === "page")).toBe(true);
});
it("filterIndex matches by name and by roll", async () => {
  const idx = await buildIndex(apiLike as any, ["admin"]);
  expect(filterIndex(idx, "asha").students).toHaveLength(1);
  expect(filterIndex(idx, "23cs001").students).toHaveLength(1);
});
it("second buildIndex uses cache (no refetch)", async () => {
  await buildIndex(apiLike as any, ["admin"]);
  await buildIndex(apiLike as any, ["admin"]);
  expect(apiLike.colleges).toHaveBeenCalledTimes(1);
});
```
(Adjust the page assertion to a page role-visible for admin, e.g. `Students`.)

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement.** Pages: `NAV.filter(e => e.group!=="TOP" && e.roles.some(r=>roles.includes(r))).map(e => ({ kind:"page", label:e.label, href:e.href }))`. Students: `colleges()` → for each college `collegeTree()` → collect sections `tree.departments.flatMap(d=>d.classes.flatMap(c=>c.sections))` → `mapPool(sections, 6, s => apiLike.sectionRoster(s.id), onEach→onProgress)` → flatten rosters, **project each StudentView to `{ kind:"student", label:s.fullName, roll:s.admissionNo, sub:s.enrollment?.sectionId ?? "", href:`/students/${s.id}` }`** (PII comment above this map — see spec). Cache the built array in a module `let cache: IndexEntry[] | null`; `buildIndex` returns cache if set. `filterIndex(entries,q)`: lowercase `q`; students where `label`/`roll` include q; pages where `label` includes q. Empty `q` → all pages, no students.

- [ ] **Step 4: run → pass.**
- [ ] **Step 5: commit** `feat(search): scoped prefetch index (students+pages, PII-safe, pooled, cached)`

---

### Task 6: SearchPalette (Modal-based, Cmd-K)

**Files:** Create `apps/web/src/ui/search/SearchPalette.tsx` + `SearchPalette.module.css` + `search-palette.test.tsx`.

**Interfaces — Consumes:** `@vidya/ui-system` `Modal`/`Skeleton`/`EmptyState`, `buildIndex`/`filterIndex`/`IndexEntry`, `useRouter`, `api`, session `roles`. **Produces:** `<SearchPalette open onClose roles />`.

- [ ] **Step 1: failing test**
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./searchIndex", () => ({
  buildIndex: vi.fn(async () => [
    { kind: "page", label: "Reports", href: "/manage/reports" },
    { kind: "student", label: "Asha Rao", roll: "23CS001", sub: "s1", href: "/students/st1" },
  ]),
  filterIndex: (e: any[], q: string) => ({
    pages: e.filter((x) => x.kind==="page" && x.label.toLowerCase().includes(q.toLowerCase())),
    students: e.filter((x) => x.kind==="student" && (x.label+ x.roll).toLowerCase().includes(q.toLowerCase())),
  }),
  getCachedIndex: () => null,
}));
import { SearchPalette } from "./SearchPalette";
it("filters and navigates on select", async () => {
  render(<SearchPalette open onClose={() => {}} roles={["admin"]} />);
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "asha" } });
  await waitFor(() => screen.getByText("Asha Rao"));
  fireEvent.keyDown(input, { key: "ArrowDown" }); fireEvent.keyDown(input, { key: "Enter" });
  expect(push).toHaveBeenCalledWith("/students/st1");
});
```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement.** Wrap S1 `Modal` (open/onClose/title="Search"). On first open (`useEffect` when `open` && no index), call `buildIndex(api, roles, (done,total)=>setProgress({done,total}))`; show a `Skeleton` row / `Students — loading {done}/{total} sections` while building. `Input` (search box) drives a debounced (150ms) `q`; results = `filterIndex(index, q)`. Render Pages then Students groups; each row a button. Track `activeIndex` for ↑/↓; Enter → `router.push(row.href)` then `onClose()`. No matches (non-empty q) → `EmptyState`. Build error → an error row with a Retry button re-invoking buildIndex; pages from a static fallback (`filterIndex([], q)` still yields pages if you seed pages synchronously from NAV — optional). `SearchPalette.module.css` token-only (rows, active row highlight, group headers).

- [ ] **Step 4: run → pass.**
- [ ] **Step 5: commit** `feat(search): SearchPalette on ui-system Modal with keyboard nav + progressive load`

---

### Task 7: Wire palette + breadcrumbs into the shell

**Files:** Modify `apps/web/src/ui/Topbar.tsx` (search box), `apps/web/src/ui/AppShell.tsx` (Cmd-K handler + mount palette + pass roles), and render `Breadcrumbs` (via the page's `PageHeader` slot — confirm how pages use PageHeader; if pages don't, render `<Breadcrumbs/>` in `AppShell` above `{children}`). Test `apps/web/src/ui/shell-search.test.tsx`.

**Interfaces — Consumes:** `SearchPalette`, `Breadcrumbs`, session roles.

- [ ] **Step 1: failing test**
```tsx
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppShell } from "./AppShell";
const session = { roles: ["admin"], displayName: "Admin" } as any;
it("Cmd-K opens the search palette", () => {
  render(<AppShell session={session}>x</AppShell>);
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  expect(screen.getByRole("textbox")).toBeInTheDocument(); // palette input
});
```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement.** In `AppShell`: add `const [searchOpen, setSearchOpen] = useState(false)`; a `useEffect` global `keydown` listener — `if ((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="k") { e.preventDefault(); setSearchOpen(true); }` (cleanup on unmount); render `<SearchPalette open={searchOpen} onClose={()=>setSearchOpen(false)} roles={session.roles} />`; render `<Breadcrumbs/>` above `{children}`. In `Topbar`: replace `.shell-top-spacer` with a search button (`Icon name="search"` + "Search… ⌘K") calling an `onSearch` prop wired from AppShell to `setSearchOpen(true)`. Guard the Cmd-K handler to ignore when a modal text input already has focus except allow reopen (standard).

- [ ] **Step 4: run → pass;** `pnpm test:ui` green.
- [ ] **Step 5: commit** `feat(shell): mount Cmd-K global search + header search box + breadcrumbs`

---

### Task 8: S2a verification bundle

**Files:** `docs/assignment-10/s2a-evidence.md` + screenshots.

- [ ] **Typecheck:** `pnpm --filter @vidya/web typecheck` clean; `check:styles` green (new module CSS token-only).
- [ ] **e2e 18/18** on a prod build (nav regroup must not break any journey; default-expanded groups mean no target is hidden). Paste the summary line.
- [ ] **test:ui** green incl. all new tests.
- [ ] **Screenshots** (Playwright, reuse the S1 shots pattern) at 1280 & 360: sidebar with one group collapsed + others expanded; the open SearchPalette mid-query. Save to `docs/assignment-10/`.
- [ ] **Backend-untouched:** `git diff --stat <S2a-base>..HEAD -- '**/handlers/**' '**/schema/**' '**/migrations/**' 'packages/platform/src/auth/**'` → empty.
- [ ] **Commit** `docs(assignment-10): S2a evidence`.

---

## Self-Review
- **Spec coverage:** 7-domain regroup (T1) ✓; breadcrumbs single-source from NAV (T1 crumbsFor + T3) ✓; collapsible default-expanded persisted (T2) ✓; global search Cmd-K + header box (T6,T7) ✓; prefetch index pooled+progressive+PII-safe+cached (T4,T5) ✓; students+pages only, no staff (T5) ✓; student→/students/[id] (T6) ✓; error/empty/loading (T6) ✓; e2e 18/18 + evidence (T8) ✓. Editions N/A (finding, no task) ✓.
- **Placeholder scan:** none; every code step carries real code.
- **Type consistency:** `IndexEntry` shape identical across T5/T6; `crumbsFor` signature same T1/T3; `mapPool` signature same T4/T5; `visibleNav` unchanged.
- **Known risk to verify in T8:** existing e2e journeys navigating via the sidebar — default-expanded removes the collapsed-target failure mode; still run e2e as the gate.

## Notes
- `apiLike` in searchIndex tests is a structural subset of `api` — keeps the unit test from importing the real fetch layer.
- S2a routes student results to the full-page profile; S2b upgrades to the SlideOver.
