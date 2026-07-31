# Assignment #10 · S1 (ui-system foundation) — Verification Evidence

Branch: `feat/assignment-10-ui-overhaul` · S1 range: `09d7c0f..HEAD`
Sub-project S1 of 5 (foundation). Presentation/tokens only.

## 1. Full e2e — GREEN (regression net held)
Fresh prod build + worker, `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e`:

```
18 passed (44.5s)
[route-coverage] 142 RouteSpecs across 15 modules; 0 missing files; 0 returned 404
```
All 7 role journeys + negative-scope matrix + route inventory green — every
journey logs in through the **ported** login screen, so this is the parity proof.
(Baseline was locked at 18/18 before S1 began; see [[e2e-run-recipe]] — worker
must run + prod build.)

## 2. Typecheck — S1 surfaces clean
- `pnpm --filter @vidya/ui-system typecheck` → **clean** (`tsc --noEmit`, no errors).
- `pnpm --filter @vidya/web typecheck` → **clean**.
- The strict package typecheck caught a real latent bug during the build:
  `Tabs` keyboard nav indexed `tabs[]` under `noUncheckedIndexedAccess` without
  a guard (invisible to vitest/esbuild) — fixed in Task 17.
- **Pre-existing, NOT S1:** `pnpm -r typecheck` fails only in
  `packages/modules/academics/src/api/handlers.test.ts:288` (a test-mock
  signature mismatch). That error is present at the branch base `09d7c0f`, and
  `git diff 09d7c0f..HEAD -- packages/modules/academics` is **empty** — S1 never
  touched academics. Out of scope for a presentation-only assignment.

## 3. Unit/UI tests — fully green
`pnpm test:ui` → **149 passed (47 files)**. No known-red tests: the previously
red `apps/web/src/ui/login.test.tsx` was rewritten with the login port (Task 19).

## 4. Design-system non-negotiables (proven, not asserted)
- Figures use IBM Plex Mono (`--font-figure`) — present in the figure primitives:
  ```
  grep -l font-figure Table/Table.module.css StatCard/StatCard.module.css  → both
  ```
- Status is never color-alone — `StatusBadge` sets `data-status` AND requires a
  text label (`children` is TS-required); `Toast` renders a default per-status
  glyph even without a caller icon (Task 14 fix).
- Single token source: `packages/ui-system/src/tokens.css` (the two competing
  `:root` sets in globals.css collapsed to one; strip/series tokens preserved).

## 5. No ad-hoc styling — permanent gate
`node scripts/check-no-adhoc-hex.mjs` → **`no ad-hoc color literals ✓`**.
- Fails the build on any hex OR css color function (`rgb/rgba/hsl/hsla/hwb/lab/
  lch/oklab/oklch/color(`) outside `tokens.css`, repo-wide, excluding build dirs.
- Comment/`url(#…)`-aware (no false trips). Wired into `pnpm lint` as `check:styles`.
- Shrinking ignore-list = **only** `apps/web/app/globals.css` (legacy sheet, S2
  empties it as screens migrate).
- Self-tested: injecting `#123456` (and a stray `hsl()`) fails with file:line;
  reverting passes.

## 6. Zero backend changes (hard constraint)
```
git diff --stat 09d7c0f..HEAD -- '**/handlers/**' '**/schema/**' '**/migrations/**' 'packages/platform/src/auth/**'
→ (empty)
```
No handler, schema, migration, or platform-auth file changed.

## 7. Proof-of-parity screen
`apps/web/app/login/page.tsx` imports UI **only** from `@vidya/ui-system`
(`Button`, `Input`); no legacy `@/ui/*` component imports remain. All `.login-*`
rules deleted from `globals.css`; one page-scoped `login.module.css` (tokens-only).
Screenshots: `docs/assignment-10/login-1280.png`, `login-360.png`.

## What S1 delivered
`packages/ui-system` with `tokens.css` + **15 primitives** (Button, Input,
Select, DatePicker, Table, StatusBadge, Card, Skeleton, EmptyState, Tabs,
PageHeader, Modal, SlideOver, Toast, StatCard), each a colocated CSS-Module
component with a colocated test; the permanent hex gate; and the login screen
ported as the parity proof. The other ~27 screens migrate in **S2**.
