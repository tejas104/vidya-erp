# ui-system Foundation (Assignment #10 · S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `packages/ui-system` — one token source plus the 15 standardized primitives, each with encapsulated CSS Modules — and prove parity by porting the login screen onto it, with the 18-journey e2e net staying green.

**Architecture:** A new workspace package `@vidya/ui-system` owns `tokens.css` (a single `:root` collapsed from the two competing sets in `globals.css`) and one folder per primitive (`<Name>.tsx` + `<Name>.module.css`). `@vidya/web` consumes it via `transpilePackages`. Components are ports of the existing `apps/web/src/ui/*` components; styling is lifted out of `globals.css` (whose rules already reference `var(--token)`) into colocated modules. Shared components are deleted only when the last screen importing them migrates (S2), so in S1 only the login screen's bespoke classes go.

**Tech Stack:** Next 16 (App Router, `output: standalone`), React 19, TypeScript (strict), CSS Modules, vitest `ui` project (jsdom + @testing-library/react), Playwright e2e.

## Global Constraints

- **Presentation only.** ZERO edits under any module's `handlers/`, `schema/`, `migrations/`, or platform `auth/`. If a UI need seems to require a backend change: STOP and report it as a finding.
- **Baseline is 18/18 green** and must stay green. Run e2e per [[e2e-run-recipe]]: worker up (`set -a; . ./.env; set +a; pnpm --filter @vidya/worker start`), prod build (`pnpm --filter @vidya/web build`), server on `-p 3001`, then `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e`.
- **Fixed type scale:** only `12/14/16/20/24/32` (as `--text-*`). No arbitrary px sizes in any `.module.css`.
- **Fixed spacing:** only `4/8/12/16/24/32/48` (as `--space-1..7`).
- **Color is status-only + never color-alone.** Status primitives pair color with an icon or label. No pastel surface fills.
- **Figures use `--font-figure`** (IBM Plex Mono): roll numbers, amounts, percentages, table dates. UI text uses `--font-sans` (Inter).
- **Hex literals live ONLY in `packages/ui-system/src/tokens.css`.** Every `.module.css` uses `var(--token)`.
- **Tables compact:** 40px row height.
- **Branch:** `feat/assignment-10-ui-overhaul`. Commit after every task.
- **Preserve the rendering Register non-negotiables:** Plex Mono figures, 1px hairline rules (`--rule`/`--rule-strong`), status-never-color-alone.

## File Structure

```
packages/ui-system/
  package.json          @vidya/ui-system; peerDeps react/react-dom; exports "." -> src/index.ts, "./tokens.css"
  tsconfig.json         extends ../../tsconfig.base.json; types: []; include src
  src/
    tokens.css          single :root (+ dark variants) — the only file with hex
    index.ts            barrel export
    Button/    Button.tsx    Button.module.css    Button.test.tsx
    Input/     Input.tsx     Input.module.css     Input.test.tsx
    Select/    Select.tsx    Select.module.css    Select.test.tsx
    DatePicker/DatePicker.tsx DatePicker.module.css DatePicker.test.tsx
    Table/     Table.tsx     Table.module.css     Table.test.tsx
    StatusBadge/StatusBadge.tsx StatusBadge.module.css StatusBadge.test.tsx
    Card/      Card.tsx      Card.module.css      Card.test.tsx
    SlideOver/ SlideOver.tsx SlideOver.module.css SlideOver.test.tsx
    Modal/     Modal.tsx     Modal.module.css     Modal.test.tsx
    Toast/     Toast.tsx     Toast.module.css     Toast.test.tsx
    Tabs/      Tabs.tsx      Tabs.module.css      Tabs.test.tsx
    EmptyState/EmptyState.tsx EmptyState.module.css EmptyState.test.tsx
    Skeleton/  Skeleton.tsx  Skeleton.module.css  Skeleton.test.tsx
    PageHeader/PageHeader.tsx PageHeader.module.css PageHeader.test.tsx
    StatCard/  StatCard.tsx  StatCard.module.css  StatCard.test.tsx
scripts/check-no-adhoc-hex.mjs   repo-wide hex gate with shrinking ignore-list
```

## Component Build Recipe (every primitive task follows this cycle)

Each primitive task supplies its own **props**, **test cases**, and **CSS class inventory**; the 5-step cycle is identical and defined once here:

1. **Write the failing test** — `packages/ui-system/src/<Name>/<Name>.test.tsx` (code given per task).
2. **Run & see it fail:** `pnpm exec vitest run --project ui packages/ui-system/src/<Name>/<Name>.test.tsx` → FAIL ("Cannot find module './<Name>'").
3. **Implement** `<Name>.tsx` + `<Name>.module.css`. Port the CSS by copying the named `globals.css` rule bodies (they already use `var(--token)`) into the module under local class names; snap any stray px to the `--text-*` scale; promote any raw hex to a token in `tokens.css`.
4. **Run & see it pass:** same command → PASS. Then `pnpm test:ui` (whole ui project) stays green.
5. **Export & commit:** add `export * from "./<Name>/<Name>";` to `src/index.ts`; `git add packages/ui-system/src/<Name> packages/ui-system/src/index.ts && git commit`.

CSS Modules referenced in tests: assert **behavior and roles**, not generated class names (class hashes are opaque). Where a test must check a variant, assert an attribute (`data-variant`, `aria-*`) the component sets, not the hashed class.

---

### Task 0: Package scaffold + CSS-interop spike (step zero)

De-risk the one thing that can invalidate the package shape: Next 16 tracing a **workspace package's CSS Module** into `output: standalone`. Build the skeleton with a throwaway Button and prove it renders through a prod build before writing real primitives.

**Files:**
- Create: `packages/ui-system/package.json`
- Create: `packages/ui-system/tsconfig.json`
- Create: `packages/ui-system/src/index.ts`
- Create: `packages/ui-system/src/Button/Button.tsx` (throwaway body, replaced in Task 3)
- Create: `packages/ui-system/src/Button/Button.module.css`
- Modify: `apps/web/package.json` (add dependency)
- Modify: `apps/web/next.config.ts:` `transpilePackages` array (add `@vidya/ui-system`)
- Modify: `apps/web/app/login/page.tsx` (temporary import to force CSS into the build; reverted at end of task)
- Modify: `vitest.config.ts` (ui project `include`)

**Interfaces:**
- Produces: package `@vidya/ui-system` resolvable from `@vidya/web`; `import { Button } from "@vidya/ui-system"`; `import "@vidya/ui-system/tokens.css"`.

- [ ] **Step 1: package.json**
```json
{
  "name": "@vidya/ui-system",
  "version": "0.1.0",
  "private": true,
  "description": "Vidya shared UI system: design tokens + standardized primitives (The Register).",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.css": "./src/tokens.css",
    "./package.json": "./package.json"
  },
  "scripts": { "typecheck": "tsc --noEmit" },
  "peerDependencies": { "react": "^19.2.0", "react-dom": "^19.2.0" },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: tsconfig.json**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2023", "DOM", "DOM.Iterable"], "types": [] },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 3: throwaway Button + module + barrel**

`src/Button/Button.module.css`:
```css
.btn { padding: 8px 16px; border-radius: var(--radius-sm, 8px); background: rebeccapurple; color: white; }
```
`src/Button/Button.tsx`:
```tsx
import styles from "./Button.module.css";
export function Button({ children }: { children: React.ReactNode }) {
  return <button type="button" className={styles.btn} data-spike="1">{children}</button>;
}
```
`src/index.ts`:
```ts
export * from "./Button/Button";
```
(`rebeccapurple` is deliberately loud so the spike is visually obvious; it is removed in Task 3.)

- [ ] **Step 4: wire into the web app**

`apps/web/package.json` dependencies — add `"@vidya/ui-system": "workspace:*"`.
`apps/web/next.config.ts` — add `"@vidya/ui-system"` to the `transpilePackages` array.
Run: `pnpm install`

- [ ] **Step 5: force the CSS into a real route (temporary probe)**

In `apps/web/app/login/page.tsx`, temporarily add near the top of the rendered JSX:
```tsx
import { Button as UiSpikeButton } from "@vidya/ui-system";
// ...inside the form, temporarily:
<UiSpikeButton>spike</UiSpikeButton>
```

- [ ] **Step 6: prove it through a PROD build**

Run:
```
pnpm --filter @vidya/web build
set -a; . ./.env; set +a; PORT=3001 pnpm --filter @vidya/web start -p 3001 &
curl -s http://localhost:3001/login | grep -o 'data-spike' 
```
Expected: `data-spike` present in served HTML, and the served CSS includes the `.btn` rule (open `http://localhost:3001/login`, confirm the purple button renders). This proves CSS-Module tracing works from the workspace package under standalone. **If it fails:** resolve via `transpilePackages` (already set) or add an explicit CSS entry import in `apps/web/app/layout.tsx`; if still failing, fall back to a package-owned global stylesheet (`@vidya/ui-system/styles.css`) and record the deviation in the spec.

- [ ] **Step 7: revert the probe**

Remove the temporary `UiSpikeButton` import and usage from `login/page.tsx` (the real port lands in Task 19). Leave the package, dependency, and `transpilePackages` entry in place.

- [ ] **Step 8: wire vitest to see package component tests**

In `vitest.config.ts`, the `ui` project `include`: change to
```ts
include: ["apps/web/src/**/*.test.tsx", "packages/ui-system/src/**/*.test.tsx"],
```
Run: `pnpm test:ui` → still green (no package tests yet, existing ui tests pass).

- [ ] **Step 9: Commit**
```
git add packages/ui-system apps/web/package.json apps/web/next.config.ts vitest.config.ts pnpm-lock.yaml
git commit -m "feat(ui-system): scaffold package; prove Next16 CSS-Module/standalone interop"
```

---

### Task 1: `tokens.css` — collapse the two token sets into one

**Files:**
- Create: `packages/ui-system/src/tokens.css`
- Modify: `apps/web/app/layout.tsx` (import the token css) — verify import path
- Modify: `apps/web/app/globals.css` (delete BOTH `:root` blocks + both dark blocks now owned by tokens.css)

**Interfaces:**
- Produces: `--paper*, --surface*, --rule*, --rule-width, --ink, --ink-2, --ink-3, --brand, --brand-soft, --good(-soft), --warn(-soft), --bad(-soft), --accent(-soft), --focus, --line, --rail*, --side-*, --scrim, --radius, --radius-sm, --shadow, --shadow-2, --space-1..7, --font-sans, --font-display, --font-figure, --grad-hero, --grad-brand, --grad-now, --ring-*`, plus the new `--text-12..32`.

- [ ] **Step 1: build tokens.css from the cool-navy "reference" set**

Copy the SECOND `:root { … }` block from `globals.css` (lines ~168–226, the "APP-WIDE DIRECTION" set — the one that currently wins) verbatim into `tokens.css`. Copy its dark counterparts too: the `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` block (~227–261) and the `:root[data-theme="dark"]` block (~262–294). Do NOT copy the first "Register" `:root`/dark blocks (~13–156) — they are shadowed. Add the fixed type scale into the light `:root`:
```css
  --text-12: 12px; --text-14: 14px; --text-16: 16px;
  --text-20: 20px; --text-24: 24px; --text-32: 32px;
```
Keep `--font-figure` (Plex Mono) and add an alias `--font-mono: var(--font-figure);` so ported rules that referenced `--font-mono` keep working during S2.

- [ ] **Step 2: import tokens.css before globals.css**

In `apps/web/app/layout.tsx`, add `import "@vidya/ui-system/tokens.css";` immediately BEFORE the existing `import "./globals.css";`. (Source order: tokens first, globals second — globals no longer defines these vars.)

- [ ] **Step 3: delete the now-duplicated blocks from globals.css**

Delete lines ~13–156 (Register `:root` + its two dark blocks) AND lines ~168–294 (reference `:root` + its two dark blocks) from `globals.css`. Everything from `* { box-sizing }` onward stays. All those class rules already reference the token names, now supplied by `tokens.css`.

- [ ] **Step 4: prove no visual regression through a prod build**

Run the full build + e2e (Global Constraints recipe). Expected: **18/18 green**. Open `/login` and `/dashboard` at 1280px — visually identical to before (same cool-navy palette).

- [ ] **Step 5: Commit**
```
git add packages/ui-system/src/tokens.css apps/web/app/layout.tsx apps/web/app/globals.css
git commit -m "feat(ui-system): single token source; drop shadowed duplicate :root sets"
```

---

### Task 3: Button (real)

Replaces the Task-0 throwaway. Source: `apps/web/src/ui/Button.tsx` (+ `.btn*` rules in `globals.css` ~722–751, 1055–1061). Adds the `secondary` variant the assignment requires.

**Files:** Create/replace `Button.tsx`, `Button.module.css`, `Button.test.tsx`.

**Interfaces:**
- Produces: `Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary"|"secondary"|"danger"|"ghost"; size?: "md"|"sm"; loading?: boolean })`. Sets `data-variant`, `type="button"` default, `disabled` while loading, `aria-busy`, renders `"Working…"` when loading.

- [ ] **Step 1: failing test** — `Button.test.tsx`
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("does not fire while loading, and shows a working label", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} loading>Save</Button>);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveTextContent("Working…");
  });
  it("exposes its variant for styling hooks", () => {
    render(<Button variant="secondary">x</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-variant", "secondary");
  });
});
```

- [ ] **Step 2: run → fail** (`Cannot find module` / old throwaway lacks `data-variant`).

- [ ] **Step 3: implement**

`Button.tsx`:
```tsx
"use client";
import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "primary", size = "md", loading = false, disabled, children, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm"; loading?: boolean }) {
  const cls = [styles.btn, styles[variant], size === "sm" ? styles.sm : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} data-variant={variant} disabled={disabled || loading}
      aria-busy={loading || undefined} {...rest}>
      {loading ? "Working…" : children}
    </button>
  );
}
```
`Button.module.css` (port `.btn` bodies; `secondary` = outline):
```css
.btn { font-family: var(--font-sans); font-size: var(--text-16); font-weight: 600;
  padding: 11px 20px; border-radius: var(--radius-sm); border: 1px solid var(--ink);
  background: var(--ink); color: var(--paper-raised); cursor: pointer;
  transition: transform .08s ease, opacity .15s ease; }
.btn:hover { opacity: .9; }
.btn:active { transform: translateY(1px); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.sm { padding: 7px 14px; font-size: var(--text-14); }
.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.secondary { background: transparent; color: var(--ink); border-color: var(--rule-strong); }
.danger { background: var(--bad); border-color: var(--bad); color: #fff; }
.ghost { background: transparent; color: var(--ink); border-color: transparent; }
```
(`#fff` here is on-brand button ink — if the hex gate flags it, promote to `--on-brand: #fff;` in `tokens.css`.)

- [ ] **Step 4: run → pass**, then `pnpm test:ui` green.
- [ ] **Step 5: export & commit** (`feat(ui-system): Button primitive with 4 variants`).

---

### Task 4: Input · Task 5: Select · Task 6: DatePicker

Source: `apps/web/src/ui/Field.tsx` + `.field*` rules in `globals.css` (~753–780, 1062–1076). Input/Select/DatePicker each render their own control plus the label/hint/error scaffold.

**Interfaces (Produces):**
- `Input(props: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string })` — renders `<label>` associated via generated id, `<input>`, and a `role="alert"` error node when `error` set.
- `Select(props: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string; options: { value: string; label: string }[] })`.
- `DatePicker(props: Omit<InputHTMLAttributes<HTMLInputElement>,"type"> & { label: string; hint?: string; error?: string })` — `Input` with `type="date"`; native picker, no dependency.

- [ ] **Input test** (`Input.test.tsx`):
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./Input";
it("labels the control and surfaces an error", () => {
  render(<Input label="Roll no" error="Required" defaultValue="" />);
  expect(screen.getByLabelText("Roll no")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Required");
});
```
- [ ] **Input impl** (`Input.tsx`):
```tsx
"use client";
import { useId, type InputHTMLAttributes } from "react";
import styles from "./Input.module.css";
export function Input({ label, hint, error, id, className, ...rest }:
  InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const auto = useId(); const inputId = id ?? auto;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>{label}</label>
      <input id={inputId} className={[styles.input, className ?? ""].join(" ")} {...rest} />
      {hint !== undefined && error === undefined ? <p className={styles.hint}>{hint}</p> : null}
      {error !== undefined ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
```
`Input.module.css` — port `.field`, `.field label`, `.field input`, `.field-hint`, `.formerror` bodies; sizes snap to `--text-14` (label/hint) and `--text-16` (input).
- [ ] **Select** — mirror Input, rendering `<select>` + `options.map(<option>)`; port `.field select` rule. Test: `getByLabelText` returns a combobox; error surfaces.
- [ ] **DatePicker** — `Input` variant with `type="date"`. Test: `getByLabelText("Date")` has `type="date"`.
- [ ] Commit each (`feat(ui-system): Input/Select/DatePicker form primitives`).

---

### Task 7: Table

Source: `apps/web/src/ui/DataTable.tsx` + `.ui-table*` rules (`globals.css` ~1241–1262). Compact (40px rows), sticky header, sortable headers, `overflow-x:auto` wrapper.

**Interfaces (Produces):**
- `Table<T>({ columns, rows, sort, onSortChange }: { columns: { key: keyof T & string; header: string; sortable?: boolean; figure?: boolean }[]; rows: T[]; sort?: { key: string; dir: "asc"|"desc" }; onSortChange?: (key: string) => void })`. `figure: true` columns render cells in `--font-figure`. Wrapper `<div>` has `overflow-x: auto`; `<thead>` is `position: sticky`.

- [ ] **Test** (`Table.test.tsx`): renders headers + rows; clicking a sortable header calls `onSortChange` with its key; a `figure` column cell carries `data-figure="1"`.
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Table } from "./Table";
it("sorts on header click and marks figure cells", () => {
  const onSortChange = vi.fn();
  render(<Table columns={[{ key: "roll", header: "Roll", sortable: true, figure: true }]}
    rows={[{ roll: "23CS001" }]} onSortChange={onSortChange} />);
  fireEvent.click(screen.getByRole("button", { name: /Roll/ }));
  expect(onSortChange).toHaveBeenCalledWith("roll");
  expect(screen.getByText("23CS001")).toHaveAttribute("data-figure", "1");
});
```
- [ ] **Impl** — `<div className={styles.wrap}><table className={styles.table}>`; sortable headers render a `<button>` calling `onSortChange(col.key)`; cells with `col.figure` get `data-figure="1"` + `styles.figure`. `Table.module.css`: port `.ui-tablewrap`/`.ui-table*`; set `td { height: 40px; }` (compact), `thead { position: sticky; top: 0; }`, `.figure { font-family: var(--font-figure); font-variant-numeric: tabular-nums; }`.
- [ ] Commit (`feat(ui-system): compact sortable Table`).

---

### Task 8: StatusBadge

Source: `apps/web/src/ui/Badge.tsx` + `.ui-badge*` (`globals.css` ~1077–1091). **Never color-alone:** always renders an icon or text label beside the color.

**Interfaces (Produces):**
- `StatusBadge({ status, children, icon }: { status: "good"|"warn"|"danger"|"info"|"neutral"; children: React.ReactNode; icon?: React.ReactNode })`. Sets `data-status`. Requires `children` (the label) — color is never the only signal.

- [ ] **Test:** renders label text; carries `data-status`; when `icon` omitted the text label is still present (asserts non-color signal).
- [ ] **Impl:** `<span className={styles.badge} data-status={status}>{icon}{children}</span>`; module ports `.ui-badge` + `.good/.warn/.danger` mapped from `data-status`; add `info` = `--brand-soft`/`--brand`. Sizes → `--text-12`.
- [ ] Commit (`feat(ui-system): StatusBadge (color + label, never color-alone)`).

---

### Task 9: Card · Task 10: Skeleton · Task 11: EmptyState

Straightforward ports.
- **Card** — source `Card.tsx` + `.card` (~410–416). `Card({ title?, actions?, children })`; ports panel surface/border/shadow. Test: title + children render.
- **Skeleton** — source `Skeleton.tsx` + `.ui-skel`/`ui-shimmer` (~1272–1281). `Skeleton({ width?, height? })`; ports shimmer keyframes into the module. Test: renders with `aria-hidden="true"`.
- **EmptyState** — source `EmptyState.tsx`. `EmptyState({ title, body?, action? })` where `action` is a `{ label, onClick }` rendered as a `Button` (the "next action"). Test: clicking the action button fires `onClick`.
- [ ] Commit each.

---

### Task 12: Tabs · Task 13: PageHeader

- **Tabs** — source `Tabs.tsx` + `.ui-tabs/.ui-tab` (~1282–1303). `Tabs({ tabs: {id,label}[], active, onChange })`; roving-tabindex + Arrow key nav; active tab `aria-selected`. Test: ArrowRight moves selection and calls `onChange`.
- **PageHeader** — source `PageHeader.tsx` + `.ui-pagehead*` (~1263–1271). `PageHeader({ title, breadcrumb?, actions? })` — `breadcrumb` slot (rendered above title) + `actions` slot. Test: title, breadcrumb, and an action all render.
- [ ] Commit each.

---

### Task 14: Modal · Task 15: SlideOver · Task 16: Toast

Overlays. Source: `Modal.tsx`, `StudentDrawer.tsx`, `.ui-scrim/.ui-modal*/.ui-toast*` (`globals.css` ~1093–1238), and `overlayStack.ts` (reuse the existing stack helper; do not reimplement).

- **Modal** — `Modal({ open, onClose, title, children, footer? })`. Focus-trap, ESC closes, scrim click closes, `role="dialog"` + `aria-modal`. Test: renders when `open`; ESC calls `onClose`; focus lands inside.
- **SlideOver** — generic right drawer `SlideOver({ open, onClose, title, children, width? })`. Same a11y as Modal but slides from the right. Test: `role="dialog"`, ESC closes, `aria-label` = title. (`StudentDrawer` is refactored in S2 to compose this; not in S1.)
- **Toast** — `ToastProvider` (context) + `useToast()` returning `push({ status, message, icon? })`; renders `.ui-toast` stack; status + icon/label (never color-alone); auto-dismiss timer. Test: a component calling `push` renders the message with `role="status"`.
- [ ] Commit each.

---

### Task 17: `index.ts` barrel + package typecheck

- [ ] Ensure `src/index.ts` exports all 15 primitives (+ `ToastProvider`, `useToast`, exported prop types).
- [ ] Run `pnpm --filter @vidya/ui-system typecheck` → clean.
- [ ] Run `pnpm test:ui` → all package + app ui tests green.
- [ ] Commit (`feat(ui-system): barrel export + typecheck clean`).

---

### Task 18: Permanent no-ad-hoc-hex gate (repo-wide, shrinking ignore-list)

Makes "no ad-hoc styling" enforceable on every future commit, not just S1.

**Files:**
- Create: `scripts/check-no-adhoc-hex.mjs`
- Modify: `package.json` (add `"check:styles"` script; wire into `lint`)

- [ ] **Step 1: the check** — `scripts/check-no-adhoc-hex.mjs`:
```js
// Fails if any CSS hex (#abc/#aabbcc) or rgb()/rgba() literal appears in a
// styling source OUTSIDE tokens.css and files on the shrinking ignore-list.
// S2 empties IGNORE as screens migrate; when IGNORE is [], globals.css is gone.
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
const IGNORE = new Set([
  "apps/web/app/globals.css",            // legacy sheet — S2 deletes it
  // add nothing here; only remove as screens migrate
]);
const ALLOW = "packages/ui-system/src/tokens.css";
const files = globSync("{apps,packages}/**/*.{css,module.css}", { exclude: ["**/node_modules/**"] });
const hex = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
const offenders = [];
for (const f of files) {
  const rel = f.replaceAll("\\", "/");
  if (rel === ALLOW || IGNORE.has(rel)) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => { if (hex.test(l)) offenders.push(`${rel}:${i + 1}: ${l.trim()}`); });
}
if (offenders.length) {
  console.error("Ad-hoc color literals found outside tokens.css:\n" + offenders.join("\n"));
  process.exit(1);
}
console.log("no ad-hoc color literals ✓");
```
(If `#fff` was used in Button/others, promote to `--on-brand` in tokens.css so this passes — see Task 3 note.)

- [ ] **Step 2: wire it** — `package.json` scripts: add `"check:styles": "node scripts/check-no-adhoc-hex.mjs"`, and append `&& pnpm check:styles` to `lint` (or add to CI). Run `pnpm check:styles`.
- [ ] **Step 3: self-test the gate** — temporarily add `color:#123456` to any `.module.css`, run, confirm it FAILS; revert, confirm it PASSES.
- [ ] **Step 4: Commit** (`chore(ui-system): repo-wide ad-hoc-hex gate with shrinking ignore-list`).

---

### Task 19: Port the login screen (proof of parity)

**Fallback trigger:** if login would need MORE than one page-scoped `.module.css` OR ANY primitive not in the S1 list, switch to porting `dashboard/page.tsx` instead (same steps, its `.td-*`/`.stat*` classes). The gradient hero may be the one allowed page-scoped module.

**Files:**
- Modify: `apps/web/app/login/page.tsx` (use `Button`, `Input` from `@vidya/ui-system`)
- Create: `apps/web/app/login/login.module.css` (the split-hero — the one page-scoped module)
- Modify: `apps/web/app/globals.css` (DELETE all `.login-*` rules, ~781–931)

- [ ] **Step 1:** Read `login/page.tsx`; replace its `Button`/`Field`+`input` usages with `@vidya/ui-system` `Button`/`Input`. Move the `.login-*` visual rules into `login.module.css`, referencing `var(--token)`; apply via `styles.*`.
- [ ] **Step 2:** Delete the `.login-*` block from `globals.css`.
- [ ] **Step 3: prod build + e2e** (recipe) → **18/18 green** (every journey logs in through this screen — it is the parity proof).
- [ ] **Step 4: screenshots** at 1280 and 360 (see Task 20 tooling); eyeball parity with pre-port login.
- [ ] **Step 5:** `pnpm check:styles` → passes (login no longer holds hex; hero uses tokens).
- [ ] **Step 6: Commit** (`feat(ui-system): port login onto ui-system; drop bespoke .login-* classes`).

---

### Task 20: S1 verification bundle (evidence)

**Files:** Create `docs/assignment-10/s1-evidence.md` collecting the outputs below.

- [ ] **Typecheck:** `pnpm -r typecheck` → clean. Paste output.
- [ ] **E2E:** full suite (recipe) → **18/18 green**. Paste the summary line.
- [ ] **Screenshots:** a tiny Playwright script `tests/shots/login.shots.ts` that loads `/login` at 1280×800 and 360×740 and writes PNGs to `docs/assignment-10/`. Run it; attach both.
- [ ] **Non-negotiables grep (proof, not assumption):**
```
grep -rn "font-figure" packages/ui-system/src/Table packages/ui-system/src/StatCard
grep -rn "data-status" packages/ui-system/src/StatusBadge   # color paired with label
```
Expected: figure font present in Table + StatCard; StatusBadge sets data-status alongside a label child.
- [ ] **No-ad-hoc-hex:** `pnpm check:styles` → passes. Paste output.
- [ ] **Backend-untouched proof:**
```
git diff --stat main...HEAD -- '**/handlers/**' '**/schema/**' '**/migrations/**' 'packages/platform/src/auth/**'
```
Expected: EMPTY. Paste the (empty) output.
- [ ] **Login imports only ui-system for UI:**
```
grep -nE "from \"@/ui/" apps/web/app/login/page.tsx    # expect: none
grep -nE "@vidya/ui-system" apps/web/app/login/page.tsx # expect: present
```
- [ ] **Commit** (`docs(assignment-10): S1 verification evidence`).

---

## Self-Review

**Spec coverage:**
- Package + tokens + CSS-Modules-per-primitive → Tasks 0,1,3–17. ✓
- 15 primitives incl. DatePicker + Toast (the two new) → Tasks 3–16. ✓
- Step-zero interop spike → Task 0. ✓
- Token collapse (two sets → one, cool-navy wins, dark preserved) → Task 1. ✓
- Non-negotiables preserved + asserted → Tasks 1,7,8,20. ✓
- Permanent hex gate w/ shrinking ignore-list → Task 18. ✓
- Login proof + fallback trigger → Task 19. ✓
- Exit criteria (typecheck, 18/18, 1280/360 shots, grep, zero backend diff) → Task 20. ✓
- Delete-as-replaced (S1 = only `.login-*`) → Task 19; shared components deferred to S2 (out of scope, stated). ✓

**Placeholder scan:** no TBD/TODO; every code step carries real code or an exact command. ✓

**Type consistency:** `Button` variant union matches `data-variant`; `Table` `onSortChange(key)` matches its test; `useToast().push({status,message})` matches Toast test; `EmptyState.action` is `{label,onClick}` consistently. ✓

**Task numbering note:** Task 2 intentionally folded into Task 0 (vitest wiring) — numbering jumps 1→3 by design; no missing task.
