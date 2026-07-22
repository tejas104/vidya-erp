# S2b — Screen migration onto ui-system Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the ~27 page screens off legacy `@/ui/*` components + `globals.css` classes onto `@vidya/ui-system` primitives, with a shared loading/error/empty wrapper, a generalized student SlideOver, and a raw-px/scale gate — presentation-only, e2e stays 18/18.

**Architecture:** Three foundation pieces first (scale gate, `AsyncState` wrapper, `StudentSlideOver`), then per-screen migration applied in domain batches via a fixed recipe; legacy primitives deleted as their last consumer migrates; the styling-gate ignore-list shrinks each batch.

**Tech Stack:** Next 16 App Router, React 19, `@vidya/ui-system`, CSS Modules, vitest `ui`/`unit`, Playwright e2e.

## Global Constraints

- **Presentation only.** ZERO changes under any `**/handlers/**`, `**/schema/**`, `**/migrations/**`, `packages/platform/src/auth/**`. If a task seems to need one → STOP and report a finding.
- **Scope:** the 27 `app/**/page.tsx` screens + the student SlideOver ONLY. Shared shell components (`Sidebar`,`Topbar`,`Masthead`,`Menu`,`NotificationBell`,`Noticeboard`,`DeniedState`,`ReportButton`,`TodayTimeline`) and `charts.tsx` are OUT — their `globals.css` classes stay ignore-listed.
- **Styling gates (both):** no hex/color-fn outside `tokens.css` (existing); no raw px in `padding/margin/gap/row-gap/column-gap/inset/font-size` outside `var(--space-*)`/`var(--text-*)` in any `.module.css` outside the ignore-list (new, F1). Allowed raw px: borders, `border-radius`, width/height/min/max, SVG geometry, outline, letter-spacing, transforms, durations.
- **Keep e2e-relevant selectors stable:** labels, roles, `aria-*`, form field `id`s, and visible text the journeys click MUST NOT change during migration.
- **Search stays full-page** (`/students/[id]`); SlideOver opens from tables only. Full-page profile remains for direct links.
- **e2e stays 18/18** (worker + prod build; [[e2e-run-recipe]]); `test:ui`/`unit` stay green.
- Branch `feat/assignment-10-ui-overhaul`; commit only the task's files (explicit `git add`, never `-A`).

## Legacy → ui-system mapping (used by every batch)
| Legacy `@/ui/*` | ui-system | Note |
|---|---|---|
| `Button` | `Button` | variant names align (primary/secondary/danger/ghost) |
| `Field` (input) / `Field` (select) | `Input` / `Select` | label/hint/error props |
| `DataTable`,`Column` | `Table` | columns → `{key,header,sortable?,figure?}`; add `aria-sort` (S2a minor) |
| `Badge` (tone) | `StatusBadge` (status) | tone→status; requires label child |
| `Card` | `Card` | |
| `Modal` / `ConfirmDialog` | `Modal` / `ConfirmDialog`-composed | ConfirmDialog composes ui-system Modal |
| `EmptyState` | `EmptyState` | now via `AsyncState` (F2) |
| `Skeleton` | `Skeleton` | now via `AsyncState` (F2) |
| `PageHeader` | `PageHeader` | title + breadcrumb slot (S2a `Breadcrumbs`) + actions |
| `RingStat` | `StatCard` | |
| `Tabs` | `Tabs` | |
| `useToast`/`Toast` | ui-system `ToastProvider`/`useToast` | mount provider at shell once (F2 step) |

## File Structure
```
scripts/check-scale.mjs               (F1) new gate, wired into check:styles
apps/web/src/ui/AsyncState.tsx        (F2) + AsyncState.module.css + test
apps/web/src/ui/StudentSlideOver.tsx  (F3) generalized from StudentDrawer.tsx (renamed) + test
apps/web/app/**/page.tsx (+ page.module.css)  (B1..B6) migrated screens
apps/web/app/**/**-page.test.tsx      updated per screen
apps/web/app/globals.css              legacy classes deleted per batch
apps/web/src/ui/{Button,Field,DataTable,Badge,Card,Modal,ConfirmDialog,EmptyState,Skeleton,PageHeader,RingStat,Tabs}.tsx  deleted in cleanup (C)
```

---

### Task F1: raw-px / type-scale gate

**Files:** Create `scripts/check-scale.mjs`; Modify `package.json` (`check:styles` runs it too); Create nothing else.

**Interfaces — Produces:** a script that exits 1 on off-scale spacing/type px.

- [ ] **Step 1: write the script** `scripts/check-scale.mjs`:
```js
// Fails if a raw px value appears in a spacing/type property outside the
// --space-* / --text-* tokens, in any .module.css off the ignore-list.
// Sibling to check-no-adhoc-hex.mjs; wired into `check:styles`.
import { readFileSync, globSync } from "node:fs";
const IGNORE = new Set(["apps/web/app/globals.css"]); // shrinks as screens migrate
const files = globSync("{apps,packages}/**/*.{css,module.css}", {
  exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/.turbo/**"],
});
// spacing + type properties whose values must be tokens, not raw px
const PROP = /(^|[\s;{])(padding|margin|gap|row-gap|column-gap|inset|font-size)(-[a-z]+)?\s*:\s*([^;}]*)/gi;
const RAWPX = /\b\d+(\.\d+)?px\b/;
const offenders = [];
for (const f of files) {
  const rel = f.replaceAll("\\", "/");
  if (IGNORE.has(rel)) continue;
  const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    let m;
    const re = new RegExp(PROP.source, "gi");
    while ((m = re.exec(line))) {
      const value = m[4];
      if (RAWPX.test(value)) offenders.push(`${rel}:${i + 1}: ${m[2]}${m[3] ?? ""}: ${value.trim()}`);
    }
  });
}
if (offenders.length) {
  console.error("Off-scale raw px in spacing/type (use var(--space-*)/var(--text-*)):\n" + offenders.join("\n"));
  process.exit(1);
}
console.log("spacing/type on-scale ✓");
```

- [ ] **Step 2: wire it** — `package.json`: `"check:scale": "node scripts/check-scale.mjs"`, and change `"check:styles"` to run both: `"check:styles": "node scripts/check-no-adhoc-hex.mjs && node scripts/check-scale.mjs"`. Run `pnpm check:styles` → passes (all current `packages/ui-system/src/**` modules are token-only; `globals.css` ignore-listed).

- [ ] **Step 3: self-test.** Add `padding: 13px;` to any `packages/ui-system/src/*/*.module.css`, run `node scripts/check-scale.mjs` → FAILS naming that file:line; change to `padding: var(--space-3);` → passes; also confirm `border: 1px solid …` and `width: 56px` do NOT trip it (add temporarily, run, remove). Revert.

- [ ] **Step 4: commit** `chore(ui): raw-px/type-scale gate (spacing+font-size must be tokens)`.

---

### Task F2: AsyncState wrapper (+ ui-system Toast at shell)

**Files:** Create `apps/web/src/ui/AsyncState.tsx` + `AsyncState.module.css` + `async-state.test.tsx`. Modify `apps/web/src/ui/AppShell.tsx` (mount ui-system `ToastProvider` once, if not already).

**Interfaces — Produces:**
```ts
AsyncState({ loading, error, onRetry, isEmpty, empty, children }: {
  loading: boolean; error: boolean; onRetry?: () => void;
  isEmpty?: boolean; empty?: React.ReactNode; children: React.ReactNode;
}): JSX.Element
```

- [ ] **Step 1: failing test** `async-state.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AsyncState } from "./AsyncState";
describe("AsyncState", () => {
  it("shows skeleton while loading", () => {
    render(<AsyncState loading error={false}>data</AsyncState>);
    expect(screen.queryByText("data")).not.toBeInTheDocument();
    expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument(); // skeleton
  });
  it("shows an error with a working retry", () => {
    const onRetry = vi.fn();
    render(<AsyncState loading={false} error onRetry={onRetry}>data</AsyncState>);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("shows the empty node when isEmpty, else children", () => {
    const { rerender } = render(
      <AsyncState loading={false} error={false} isEmpty empty={<div>nothing yet</div>}>rows</AsyncState>);
    expect(screen.getByText("nothing yet")).toBeInTheDocument();
    rerender(<AsyncState loading={false} error={false} isEmpty={false} empty={<div>nothing yet</div>}>rows</AsyncState>);
    expect(screen.getByText("rows")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: run → fail.** `pnpm exec vitest run --project ui apps/web/src/ui/async-state.test.tsx`

- [ ] **Step 3: implement** `AsyncState.tsx`:
```tsx
"use client";
import type { ReactNode } from "react";
import { Skeleton, Button } from "@vidya/ui-system";
import styles from "./AsyncState.module.css";
export function AsyncState({
  loading, error, onRetry, isEmpty, empty, children,
}: {
  loading: boolean; error: boolean; onRetry?: () => void;
  isEmpty?: boolean; empty?: ReactNode; children: ReactNode;
}) {
  if (loading) {
    return (
      <div className={styles.rows} aria-busy="true">
        <Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} />
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.error} role="alert">
        <span>Couldn&apos;t load this.</span>
        {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button> : null}
      </div>
    );
  }
  if (isEmpty && empty !== undefined) return <>{empty}</>;
  return <>{children}</>;
}
```
`AsyncState.module.css` (token-only, scale-compliant): `.rows { display:grid; gap:var(--space-2); }` `.error { display:flex; align-items:center; gap:var(--space-3); padding:var(--space-4); color:var(--ink-2); }`.

- [ ] **Step 4: run → pass;** `pnpm test:ui` green; `pnpm check:styles` green.

- [ ] **Step 5: commit** `feat(ui): AsyncState wrapper (loading/error-retry/empty)`.

---

### Task F3: StudentSlideOver (generalize StudentDrawer)

**Files:** Rename/rewrite `apps/web/src/ui/StudentDrawer.tsx` → `apps/web/src/ui/StudentSlideOver.tsx` (+ `StudentSlideOver.module.css` for any page-scoped bits) + `student-slideover.test.tsx`; Modify the two current callers `apps/web/app/(app)/manage/attendance/page.tsx` and `apps/web/app/(app)/manage/classes/page.tsx`; delete the `.cw-scrim`/drawer classes it stops using from `globals.css` (only if no other consumer — grep first).

**Interfaces — Consumes:** `@vidya/ui-system` `SlideOver`, `Tabs`. **Produces:**
```ts
StudentSlideOver({ student, canManage, onClose }: {
  student: DrawerStudent | null; canManage?: boolean; onClose: () => void;
}): JSX.Element   // open = student !== null; export interface DrawerStudent unchanged
```

- [ ] **Step 1: read** the current `StudentDrawer.tsx` (289 lines) — keep its `DrawerStudent` interface, its 5 tabs' CONTENT (overview/attendance/marks/fees/documents), and its `api.docList`/`docUpload`/`docDelete` logic UNCHANGED.

- [ ] **Step 2: failing test** `student-slideover.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StudentSlideOver, type DrawerStudent } from "./StudentSlideOver";
const stu = { studentId: "st1", name: "Asha Rao", rollNo: "23CS001", section: "A",
  initials: "AR", gradient: "", status: "active", pct: 90, attended: 9, total: 10,
  lastMark: null, backlogs: 0, flags: {}, phone: null, guardianName: null, guardianPhone: null, dob: null } as unknown as DrawerStudent;
describe("StudentSlideOver", () => {
  it("renders as a dialog with the student name and closes on Esc", () => {
    const onClose = vi.fn();
    render(<StudentSlideOver student={stu} onClose={onClose} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName(/Asha Rao/i);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("renders nothing when student is null", () => {
    const { container } = render(<StudentSlideOver student={null} onClose={() => {}} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
```

- [ ] **Step 3: implement.** Replace the bespoke `.cw-scrim` + drawer shell with the S1 `SlideOver` (`open={student!==null}`, `onClose`, `title={student?.name}`); render the 5 tabs via ui-system `Tabs` (ids overview/attendance/marks/fees/documents), each tab panel = the existing content moved verbatim. Keep all `api.*` calls. Any residual styling → `StudentSlideOver.module.css` (token+scale-compliant). Export `StudentSlideOver` + `DrawerStudent`.

- [ ] **Step 4:** migrate the two callers: in attendance + classes pages, change `import { StudentDrawer …}` → `import { StudentSlideOver …}` and the JSX `<StudentDrawer …/>` → `<StudentSlideOver …/>` (props identical). Delete the now-unused `.cw-scrim` + drawer-only classes from `globals.css` IF grep shows no other consumer (else leave; they migrate later).

- [ ] **Step 5: run → pass;** `pnpm test:ui` green; **e2e J3/J4** (attendance/classes journeys) green on a prod build; `check:styles` green.

- [ ] **Step 6: commit** `feat(ui): StudentSlideOver — student profile on ui-system SlideOver + Tabs`.

---

### Migration recipe (every B-task applies this per screen)
For each `page.tsx` in the batch:
1. Swap legacy `@/ui/{…}` imports → `@vidya/ui-system` per the mapping table. `useToast`/`Toast` → ui-system `useToast`.
2. Move screen-specific styling into a colocated `page.module.css` (token-only + scale-compliant); DELETE that screen's freed classes from `globals.css` (grep for other consumers first — delete only if none).
3. Wrap the screen's primary list fetch in `AsyncState` (loading skeleton / error+retry / empty with a next-action button).
4. Table columns → ui-system `Table` shape; add `aria-sort` to sortable headers (S2a minor).
5. Keep all labels/roles/`aria-*`/field `id`s/visible-text stable (e2e).
6. Update the screen's `*-page.test.tsx` to the new imports/roles — keep assertions meaningful (don't weaken to pass).
7. Run `pnpm test:ui` + `pnpm check:styles` green; commit per batch.
**Each B-task ends by removing the batch's migrated screens' page-modules from the styling-gate ignore-list** (they must now pass both gates).

---

### Task B1: PEOPLE screens
**Screens:** `manage/students`, `manage/teachers`, `manage/directory`, `manage/org`. Apply the recipe. **SlideOver wiring:** in `students` and `directory` tables, a row "view" opens `StudentSlideOver` (assemble `DrawerStudent` from the row). `org` is a tree (no student rows) — recipe only.
- [ ] Migrate each of the 4 screens (recipe steps 1–7), one commit per screen or one per batch (`feat(ui): migrate PEOPLE screens onto ui-system`). e2e J1/J4-relevant (students) green.

### Task B2: TEACH screens
**Screens:** `manage/attendance`, `manage/marks`, `manage/classes`, `manage/coursework`, `manage/my-timetable`. Recipe. (attendance/classes already use `StudentSlideOver` from F3 — just finish their primitive swap + AsyncState.) e2e **J3 (attendance), J5-marks** green.
- [ ] Migrate the 5 screens. Commit `feat(ui): migrate TEACH screens onto ui-system`.

### Task B3: RECORDS screens
**Screens:** `manage/syllabus`, `manage/exams`, `manage/timetable`, `manage/calendar`, `manage/results`, `manage/backlogs`. Recipe. **SlideOver wiring:** `results` (+ `backlogs`) student rows open `StudentSlideOver`. e2e **J2 (exams/hall-ticket)** green.
- [ ] Migrate the 6 screens. Commit `feat(ui): migrate RECORDS screens onto ui-system`.

### Task B4: FEES/COMM/REPORTS screens
**Screens:** `manage/fees`, `manage/notices`, `manage/reports`. Recipe. **SlideOver wiring:** `fees` student rows open `StudentSlideOver`. e2e **J6 (reports PDF)** + fees-relevant green.
- [ ] Migrate the 3 screens. Commit `feat(ui): migrate FEES/COMM/REPORTS screens onto ui-system`.

### Task B5: ADMINISTRATION screens
**Screens:** `manage/leave`, `manage/users`, `manage/import`, `manage/system`. Recipe. e2e **J1 (users), J7 (leave)** green.
- [ ] Migrate the 4 screens. Commit `feat(ui): migrate ADMINISTRATION screens onto ui-system`.

### Task B6: PORTAL + top-level screens
**Screens:** `portal`, `dashboard`, `students/[studentId]` (full-page profile), `manage` (index). Recipe. (dashboard uses `RingStat`→`StatCard`, `charts` STAY as-is per scope.) e2e **J5 (portal)** green.
- [ ] Migrate the 4 screens. Commit `feat(ui): migrate PORTAL + top-level screens onto ui-system`.

---

### Task C: cleanup — delete legacy primitives, shrink ignore-list
**Files:** delete `apps/web/src/ui/{Button,Field,DataTable,Badge,Card,Modal,ConfirmDialog,EmptyState,Skeleton,PageHeader,RingStat,Tabs}.tsx` + their tests; Modify both gate scripts' `IGNORE` sets; Modify `globals.css` (delete now-orphan legacy primitive classes `.btn`,`.field`,`.ui-*`,`.stat`,`.badge` if grep shows no consumer).
- [ ] **Step 1:** `grep -rl "@/ui/Button" apps/web/app` (repeat per primitive) → expect NONE. Any remaining consumer = that screen wasn't migrated; go back.
- [ ] **Step 2:** delete each legacy primitive `.tsx` + `.test.tsx` with zero `app/**` consumers. (Keep app-shell components + charts.)
- [ ] **Step 3:** remove migrated page-modules from both gates' ignore-lists (they already pass). `globals.css` stays ignore-listed (shell/charts classes remain).
- [ ] **Step 4:** `pnpm test:ui`/`pnpm test` green; `pnpm --filter @vidya/web typecheck` clean; `pnpm check:styles` green.
- [ ] **Step 5: commit** `chore(ui): delete legacy primitives superseded by @vidya/ui-system`.

### Task V: S2b verification bundle
**Files:** `docs/assignment-10/s2b-evidence.md` + screenshots.
- [ ] `pnpm --filter @vidya/web typecheck` clean; `test:ui`/`unit` green.
- [ ] **e2e 18/18** on a prod build (all journeys through migrated screens). Paste summary.
- [ ] `check:styles` (hex + scale) green; grep proof: no `@/ui/{Button,Field,DataTable,Badge,Card,Modal,EmptyState,Skeleton,PageHeader,RingStat,Tabs}` import remains in `app/**`.
- [ ] Screenshots: one migrated screen per domain + the `StudentSlideOver` open, at 1280 & 360 (reuse the shots pattern).
- [ ] Backend-untouched: `git diff --stat <S2b-base>..HEAD -- '**/handlers/**' '**/schema/**' '**/migrations/**' 'packages/platform/src/auth/**'` → empty.
- [ ] Commit `docs(assignment-10): S2b evidence`.

---

## Self-Review
- **Spec coverage:** F1 scale gate ✓ (Task F1); F2 AsyncState ✓; F3 StudentSlideOver (data-passing, tables only, search stays full-page) ✓; 27-screen migration in domain batches B1–B6 ✓; delete-as-replaced (Task C) ✓; shell/charts out ✓; e2e 18/18 + evidence (Task V) ✓; S2a-minor `aria-sort` folded into recipe step 4 ✓.
- **Placeholder scan:** F1/F2/F3 carry complete code; batch tasks carry the concrete recipe + exact screen lists + the mapping table (migration = mechanical transform of existing bespoke screens, not novel code — full per-screen code is neither possible nor useful here; the recipe + targets are the deliverable).
- **Type consistency:** `DrawerStudent` unchanged F3↔callers; `AsyncState` prop shape identical F2↔batches; mapping table stable across batches.
- **Batch-size note:** B1–B6 are larger than a single 2–5-minute step because each migrates several bespoke screens; they stay one reviewable task per domain (a reviewer can accept/reject a domain independently) and each keeps the suite green. If a batch proves too large in execution, split by screen.

## Notes
- Migration is transform-in-place of existing screens; the "complete code" rule is satisfied for novel code (F1/F2/F3) and replaced by an explicit recipe + mapping for the mechanical screen swaps.
- e2e is the gate at every journey-touching batch (noted per B-task).
