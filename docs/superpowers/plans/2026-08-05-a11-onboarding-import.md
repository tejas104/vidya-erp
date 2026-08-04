# Assignment #11 — Onboarding, help, CSV import & credentials — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can take a college from empty to operating — import students and staff from CSV with a trustworthy preview, hand every student working credentials on a printed sheet, and reach in-app help on any screen, guided by a first-run checklist.

**Architecture:** Extends what already exists rather than rebuilding it. The people module already has a working CSV import (students *and* staff, `dryRun`, a BullMQ job, per-row errors, and collision-as-error idempotency); `PageHeader` and `SlideOver` already exist in `packages/ui-system` and 26 of 28 pages already use the header. Genuinely new code is small and well-bounded: a `node:crypto` temp-password utility, an identity credential service, a credential-sheet PDF renderer, a build-time markdown→TS help compiler, and a keyed preferences table.

**Tech Stack:** TypeScript strict · pnpm workspaces · Next.js App Router · Postgres/drizzle · Redis · BullMQ · MinIO · pdfkit · zod · vitest · Playwright.

**Spec:** `docs/superpowers/specs/2026-08-05-a11-onboarding-import-design.md` — read it before Task 1. Findings 1–8 and decisions D1–D4 are established; do not re-derive them.

**Base:** `feat/a11-onboarding-import` @ `abd66e0`.

## Global Constraints

- **ADR-0009: no new runtime dependencies.** Help markdown is compiled at build time; no markdown library. `pdfkit` and `node:crypto` are already present — use them.
- **Human-owned boundary:** `packages/modules/identity/src/core/` (`PasswordHasher`, `SessionManager`, `ScopeChecker` implementations) must show an **empty diff** across the whole branch. Consume interfaces only. If something seems to require a change inside, **STOP and report the exact interface gap.**
- **All new endpoints scope-check through the shared platform `ScopeChecker`.** Never re-implement scoping.
- **All writes go through existing module services** — no direct table writes, so audit logging and never-hard-delete hold.
- **Five states per screen:** loading / empty / error / denied(403) / withheld. A failed fetch renders an **error** state, never an empty one.
- **The 26 existing e2e journeys must be green at every task boundary**, unedited. New guards go in new spec files.
- **Commit by explicit path. Never `git add -A`** — owner WIP is uncommitted (`backups/`, `certs/`, `scripts/*.sh`, `apps/web/app/(app)/manage/system/`, `docs/deployment-checklist.md`, `docs/runbook-backup-restore.md`, `.dockerignore`, `.claude/`).
- After any route change run `pnpm openapi:generate`. Gates: `pnpm check:styles` and the relevant `typecheck` stay green.
- Both themes from tokens, `:focus-visible`, `prefers-reduced-motion` respected.
- End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Test commands

```
export DATABASE_URL="postgres://vidya:local-dev-only-pg@localhost:5432/vidya" \
  REDIS_URL="redis://localhost:6379" S3_ENDPOINT="http://localhost:9000" \
  S3_ACCESS_KEY_ID="local-dev-only-minio" S3_SECRET_ACCESS_KEY="local-dev-only-minio-secret" S3_BUCKET="vidya"
```

- Unit/UI: `npx vitest run --project unit --project ui` (baseline at branch point: **698 unit / 189 ui**)
- Single file: `npx vitest run --project unit <file-substring>`
- E2E: prod build + compose stack + worker + `next start -p 3001`, then `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e`

## File structure

| File | Responsibility |
|---|---|
| `packages/platform/src/credentials/temp-password.ts` | Generate one temporary password. Nothing else. |
| `packages/platform/src/config/env.ts` (modify) | Add `VIDYA_EDITION`. |
| `packages/modules/identity/src/service/credential-service.ts` | Issue a login for a person lacking one; return the plaintext exactly once. |
| `packages/modules/people/src/service/import-service.ts` (modify) | Add the warning tier and progress counters. |
| `packages/modules/people/src/api/handlers.ts` (modify) | Template CSV + error CSV handlers. |
| `packages/modules/reporting/src/render/credential-sheet.ts` | Lay out a per-class credential sheet PDF. |
| `packages/modules/system/src/db/schema.ts` (modify) + `migrations/0001_user_preferences.sql` | Keyed per-user preferences. |
| `packages/ui-system/src/PageHeader/PageHeader.tsx` (modify) | Optional `helpSlug` → "?" button. |
| `apps/web/src/ui/help/HelpPanel.tsx` | Render a compiled help doc in the existing `SlideOver`. |
| `scripts/compile-help.ts` | Compile `content/help/**` → typed module; warn on missing docs. |
| `content/help/{edition}/*.md` | The help content itself. |

---

# PHASE 1 — Foundations (sequential, one agent at a time)

### Task 1: Edition config

**Files:**
- Modify: `packages/platform/src/config/env.ts`
- Test: `packages/platform/src/config/env.test.ts`

**Interfaces:**
- Produces: `config.edition: "college" | "school"` on the derived config object; env var `VIDYA_EDITION` (default `"college"`).

- [ ] **Step 1: Write the failing test**

```ts
it("defaults edition to college and accepts school", () => {
  expect(loadConfig({ ...baseEnv }).edition).toBe("college");
  expect(loadConfig({ ...baseEnv, VIDYA_EDITION: "school" }).edition).toBe("school");
});

it("rejects an unknown edition", () => {
  expect(() => loadConfig({ ...baseEnv, VIDYA_EDITION: "university" })).toThrow();
});
```

Match the existing test file's helper names (`loadConfig`/`baseEnv` may be named differently — read the file first and follow what is there).

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --project unit env.test`
Expected: FAIL — `edition` undefined.

- [ ] **Step 3: Implement**

In the zod schema, beside the other product-level settings:

```ts
/**
 * Product edition. Drives CSV template headers and the help-content path.
 * #11 is the first and only consumer (spec finding 5) — nothing else in the
 * app is edition-aware yet.
 */
VIDYA_EDITION: z.enum(["college", "school"]).default("college"),
```

And on the derived config object: `readonly edition: "college" | "school";` populated as `edition: env.VIDYA_EDITION`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project unit env.test` → PASS.

- [ ] **Step 5: Document and commit**

Add `VIDYA_EDITION=college` with a one-line comment to `.env.example`. **`.env.example` has uncommitted owner edits — check `git diff .env.example` first and append without reverting them.**

```bash
git add packages/platform/src/config/env.ts packages/platform/src/config/env.test.ts .env.example
git commit -m "feat(config): product edition setting"
```

---

### Task 2: Help compiler

**Files:**
- Create: `scripts/compile-help.ts`, `content/help/college/.gitkeep`
- Create: `apps/web/src/ui/help/helpSlug.ts`
- Test: `apps/web/src/ui/help/helpSlug.test.ts`
- Modify: `package.json` (build script chain)

**Interfaces:**
- Produces: `helpSlugFor(pathname: string): string` — route → slug.
- Produces: generated `apps/web/src/ui/help/help-content.generated.ts` exporting
  `export const HELP_DOCS: Record<string, { title: string; html: string }>`.

Slug rule: strip the leading `/`, drop route groups and dynamic segments (`[id]`), join with `-`. `/manage/attendance` → `attendance`; `/manage/import/students` → `import-students`; `/students/[studentId]` → `students`.

- [ ] **Step 1: Write the failing slug test**

```ts
import { helpSlugFor } from "./helpSlug";

it("derives a slug from the route", () => {
  expect(helpSlugFor("/manage/attendance")).toBe("attendance");
  expect(helpSlugFor("/manage/import/students")).toBe("import-students");
  expect(helpSlugFor("/dashboard")).toBe("dashboard");
});

it("drops dynamic segments", () => {
  expect(helpSlugFor("/students/abc-123")).toBe("students");
});

it("handles the root", () => {
  expect(helpSlugFor("/")).toBe("home");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --project ui helpSlug` → FAIL, module not found.

- [ ] **Step 3: Implement `helpSlug.ts`**

```ts
/**
 * Route -> help-doc slug. Dynamic segments are dropped rather than
 * substituted: help is written per SCREEN, and /students/<any id> is one
 * screen. "manage" is a routing prefix, not part of the screen's identity.
 */
export function helpSlugFor(pathname: string): string {
  const parts = pathname
    .split("/")
    .filter((part) => part !== "" && part !== "manage")
    // A segment that is not a stable word is an id (uuid, number, slug-with-digits).
    .filter((part) => /^[a-z][a-z-]*$/.test(part));
  return parts.length === 0 ? "home" : parts.join("-");
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Write the compiler**

`scripts/compile-help.ts`. It must do BOTH jobs in one pass (spec: one mechanism, no second code path for the warning):

```ts
/**
 * Compiles content/help/<edition>/*.md into a typed TS module at build time.
 * Why a build step and not a markdown library: ADR-0009 forbids new runtime
 * dependencies. Compiling also lets us emit the "screens with no help doc"
 * warning the assignment requires from the same pass that already knows every
 * route slug and every file on disk — one mechanism, not two.
 *
 * The supported markdown subset is deliberately small and matches what the
 * help docs actually use: h1/h2, ordered and unordered lists, paragraphs,
 * bold, inline code, and > screenshot placeholders. Anything else is escaped
 * and rendered literally rather than silently dropped.
 */
```

Requirements the implementer must satisfy:
1. Read every `.md` under `content/help/<edition>/`, where edition comes from `VIDYA_EDITION` (default `college`).
2. **Escape HTML in the source before applying any markup** — help docs are repo content, but escaping first means a doc can never inject markup.
3. Emit `apps/web/src/ui/help/help-content.generated.ts` with the `HELP_DOCS` shape above. Title = the first `# ` heading.
4. Enumerate route slugs by walking `apps/web/app/(app)/**/page.tsx` through `helpSlugFor`, and `console.warn` a single line listing every slug with no doc.
5. Add the generated file to `.gitignore` **and** commit a checked-in fallback so a fresh clone type-checks before the first build. Simplest: generate it, commit it once, and let the build overwrite it.
6. Wire into `package.json` so it runs before `next build` (`"prebuild"` or the existing build chain — read what is there).

- [ ] **Step 6: Verify the compiler runs and warns**

Run: `npx tsx scripts/compile-help.ts`
Expected: writes `help-content.generated.ts`; prints one warning line listing the ~28 slugs that have no docs yet (all of them at this point — that is correct).

- [ ] **Step 7: Commit**

```bash
git add scripts/compile-help.ts apps/web/src/ui/help/ content/help package.json .gitignore
git commit -m "feat(help): build-time markdown compiler with missing-doc warnings"
```

---

### Task 3: Help affordance on PageHeader

**Files:**
- Modify: `packages/ui-system/src/PageHeader/PageHeader.tsx`, `PageHeader.module.css`
- Create: `apps/web/src/ui/help/HelpPanel.tsx`
- Test: `packages/ui-system/src/PageHeader/PageHeader.test.tsx` (create if absent), `apps/web/src/ui/help/help-panel.test.tsx`

**Interfaces:**
- Consumes: `HELP_DOCS` and `helpSlugFor` from Task 2.
- Produces: `PageHeader` gains `helpSlug?: string`. **When omitted the header renders exactly as before** — all 26 existing call sites must be untouched and their snapshots/tests unchanged.
- Produces: `<HelpPanel slug={...} open={...} onClose={...} />` rendering into the existing `SlideOver`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders no help button when helpSlug is absent", () => {
  render(<PageHeader title="Attendance" />);
  expect(screen.queryByRole("button", { name: /help/i })).toBeNull();
});

it("renders a help button when helpSlug is given", () => {
  render(<PageHeader title="Attendance" helpSlug="attendance" />);
  expect(screen.getByRole("button", { name: /help/i })).toBeVisible();
});
```

And for the panel:

```tsx
it("shows the doc when one exists", () => {
  render(<HelpPanel slug="attendance" open onClose={() => {}} />);
  expect(screen.getByRole("heading", { name: /marking attendance/i })).toBeVisible();
});

it("shows a no-help-yet state for an unknown slug", () => {
  render(<HelpPanel slug="nope" open onClose={() => {}} />);
  expect(screen.getByText(/no help yet/i)).toBeVisible();
});
```

The first panel test needs a real doc — write `content/help/college/attendance.md` with an `# Marking attendance` heading as part of this task and re-run the compiler, or stub `HELP_DOCS` in the test. Prefer the real doc; it becomes one of Task 10's fifteen.

- [ ] **Step 2: Run and confirm they fail.** `npx vitest run --project ui PageHeader help-panel`

- [ ] **Step 3: Implement.** Add to `PageHeader`'s props and render the button beside `actions`. Use the existing `Icon` set — reuse an existing glyph, do not add one unless none fits. The button needs an accessible name (`aria-label="Help"`), `:focus-visible`, and must not shift layout when absent.

- [ ] **Step 4: Run tests** → PASS. Then run the **full ui project** to prove the 26 existing call sites are unaffected: `npx vitest run --project ui` → expect 189 + your new tests, zero failures.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-system/src/PageHeader apps/web/src/ui/help content/help
git commit -m "feat(help): help affordance on PageHeader and the help panel"
```

---

### Task 4: Convert the two PageHeader holdouts

**Files:**
- Modify: `apps/web/app/(app)/manage/classes/page.tsx` (the hand-rolled `<h1>` around line 279)
- Modify: `apps/web/app/(app)/students/[studentId]/page.tsx` (line 92, `<h1 className="page-title">`)

- [ ] **Step 1: Read both files** and note the exact heading text and any surrounding classes the e2e journeys may select.

- [ ] **Step 2: Convert each to `PageHeader`**, preserving the rendered heading **text** byte-for-byte. Pass `helpSlug` for each screen (`classes`, `students`).

- [ ] **Step 3: Run the ui suite** → `npx vitest run --project ui` — expect no regressions (`classes-page.test.tsx` exists and covers one of these).

- [ ] **Step 4: Typecheck and styles** → `pnpm --filter @vidya/web typecheck` and `pnpm check:styles`, both clean. Remove any page-local `.page-title` CSS that is now dead.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(app)/manage/classes/page.tsx" "apps/web/app/(app)/students/[studentId]/page.tsx"
git commit -m "refactor(web): last two pages onto PageHeader"
```

**Phase 1 gate:** `npx vitest run --project unit --project ui` green; `pnpm --filter @vidya/web typecheck` and `pnpm check:styles` clean. Do not start Phase 2 until this holds.

---

# PHASE 2 — Two tracks, disjoint trees, safe to run in parallel

Track A owns `packages/modules/people/**` and the import screens. Track B owns
`packages/platform/src/credentials/**`, `packages/modules/identity/src/service/**`,
`packages/modules/reporting/**`. **Neither track edits the other's files.** Within a
track, tasks run one at a time.

## TRACK A — CSV import

### Task A1: Template CSV endpoint

**Files:**
- Modify: `packages/modules/people/src/definition.ts`, `packages/modules/people/src/api/handlers.ts`
- Create: `apps/web/app/api/v1/people/imports/template/route.ts`
- Test: `packages/modules/people/src/api/handlers.test.ts`

**Interfaces:**
- Produces: route id `people.import-template`, `GET /api/v1/people/imports/template?kind=students|teachers`, ADMIN_ONLY, `contentType: "text/csv"`.

- [ ] **Step 1: Write the failing handler test**

```ts
it("returns student template headers for the college edition", async () => {
  const res = await handlers["people.import-template"](
    ctx({ query: { kind: "students" }, principal: adminPrincipal }),
  );
  expect(res.status).toBe(200);
  expect(res.contentType).toBe("text/csv");
  expect(String(res.body).split("\r\n")[0]).toBe(
    "admission_no,full_name,department_code,class_code,section_name",
  );
});
```

Follow the existing `handlers.test.ts` conventions for `ctx()` and principals — read the file first.

- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run --project unit people/src/api/handlers`

- [ ] **Step 3: Add the RouteSpec** in `definition.ts` beside `people.import-create`, mirroring its `auth: ADMIN_ONLY` and tags. `GET`, so **no `audit` block** (only state-changing methods require one).

- [ ] **Step 4: Implement the handler.** Build the row with `csvRow` from reporting's `escape-csv` if it is importable across module boundaries; if it is not, **do not** copy the escaping logic — report it and put the shared helper in `packages/platform`. Headers vary by `kind` and by `config.edition` (Task 1): the academic-structure columns come from the structure config, never hardcoded per edition.

- [ ] **Step 5: Add the Next route file**

```ts
import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("people.import-template");
```

- [ ] **Step 6: Regenerate OpenAPI and test**

Run: `pnpm openapi:generate`, then `npx vitest run --project unit people` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/modules/people/src apps/web/app/api/v1/people/imports/template openapi.json
git commit -m "feat(people): edition-aware CSV import template endpoint"
```

### Task A2: Warning tier and progress counters

**Files:**
- Modify: `packages/modules/people/src/service/import-service.ts`, `repo/imports-repo.ts`, `definition.ts` (`importViewSchema`), `db/schema.ts`
- Create: `packages/modules/people/migrations/0005_import_warnings.sql` + `.down.sql`
- Test: `packages/modules/people/src/service/import-service.test.ts`

**Interfaces:**
- Produces: `importViewSchema` gains `warningRows: z.number()`, `processedRows: z.number()`, and `warnings: z.array(z.object({ row: z.number(), message: z.string() }))`.
- **Warning definition (spec):** a row that **imports successfully with a caveat**. The only v1 warning: a student row whose optional enrollment columns (`department_code`/`class_code`/`section_name`) are blank, so the student is created **unassigned**. Errors block a row; warnings never do.

- [ ] **Step 1: Write the failing tests**

```ts
it("warns but still imports a student with no enrollment columns", async () => {
  const view = await runImport("admission_no,full_name\nA-1,Asha Rao\n", { dryRun: false });
  expect(view.okRows).toBe(1);
  expect(view.errorRows).toBe(0);
  expect(view.warningRows).toBe(1);
  expect(view.warnings[0]).toMatchObject({ row: 2, message: expect.stringMatching(/unassigned/i) });
});

it("keeps a duplicate admission number an ERROR, not a warning", async () => {
  // Guards the spec's idempotency rule: collisions are row-level errors,
  // never silent updates and never downgraded to a warning.
  const view = await runImport(existingAdmissionCsv, { dryRun: false });
  expect(view.errorRows).toBe(1);
  expect(view.warningRows).toBe(0);
});
```

- [ ] **Step 2: Run and confirm failure.** `npx vitest run --project unit import-service`

- [ ] **Step 3: Write the migration** adding `warning_rows int NOT NULL DEFAULT 0`, `processed_rows int NOT NULL DEFAULT 0`, and a `warnings jsonb NOT NULL DEFAULT '[]'` column to the imports table (read `db/schema.ts` for the real table name). Write the matching `.down.sql`.

- [ ] **Step 4: Implement** the warning classification in `import-service.ts` and have the job update `processedRows` as it goes. Keep the existing error paths untouched — read `:202`, `:232-238`, `:307`, `:314-319` and leave that logic alone.

- [ ] **Step 5: Run tests + apply the migration** → `npx tsx scripts/migrate.ts up`, then `npx vitest run --project unit people` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/modules/people
git commit -m "feat(people): import warning tier and progress counters"
```

### Task A3: Error CSV download

**Files:**
- Modify: `packages/modules/people/src/definition.ts`, `api/handlers.ts`
- Create: `apps/web/app/api/v1/people/imports/[importId]/errors/route.ts`
- Test: `packages/modules/people/src/api/handlers.test.ts`

**Interfaces:**
- Produces: route id `people.import-errors`, `GET /api/v1/people/imports/{importId}/errors`, ADMIN_ONLY, `text/csv`, columns `row,reason`.

- [ ] **Step 1: Write the failing test** asserting a 200, `text/csv`, a header line `row,reason`, one line per rejected row, and that a name like `=cmd|'/c calc'!A1` in the reason is escaped (reuse `escape-csv`; do not re-solve injection).
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Add the RouteSpec and handler.** 404 when the import does not exist.
- [ ] **Step 4: Add the Next route file** (same 4-line shape as A1 Step 5, `people.import-errors`).
- [ ] **Step 5:** `pnpm openapi:generate`, run `npx vitest run --project unit people` → PASS.
- [ ] **Step 6: Commit** — `feat(people): rejected-rows CSV download`

### Task A4: Import Students / Import Staff screens

**Files:**
- Create: `apps/web/app/(app)/manage/import/students/page.tsx`, `.../staff/page.tsx` (+ CSS modules)
- Modify: `apps/web/app/(app)/manage/import/page.tsx`, `apps/web/src/ui/navConfig.ts` (+ its test)
- Test: `apps/web/src/ui/import-page.test.tsx`

- [ ] **Step 1: Read the existing `/manage/import` page** and reuse its polling logic — do not write a second poller.
- [ ] **Step 2: Write failing UI tests** for the preview table rendering ok/warning/error rows distinctly (**icon or text, never colour alone**) and the confirm button being disabled until a dry run completes.
- [ ] **Step 3: Implement both screens.** Flow: download template → upload → `POST {dryRun:true}` → poll → preview → confirm → `POST {dryRun:false}` → summary + error-CSV link. Two nav entries under PEOPLE. All five states.
- [ ] **Step 4:** `npx vitest run --project ui` → PASS; `pnpm check:styles` and web typecheck clean.
- [ ] **Step 5: Commit** — `feat(people): import students and staff screens with preview`

### Task A5: E2E guard (a)

**Files:** Create `tests/e2e/import.spec.ts`; create a 23-row fixture (20 valid + 3 invalid).

- [ ] **Step 1: Write the journey** — upload → preview flags **exactly 3** → confirm → **21** students exist (20 new + the pre-existing seed count assertion the implementer must derive, not guess) → re-upload the same file adds **none** → error CSV downloads and contains 3 data rows.
- [ ] **Step 2: Run against a running app.** A prod build + compose stack + worker must be up; the import runs in the **worker**, so without it the job stays pending.
- [ ] **Step 3: Commit** — `test(e2e): assignment #11 import journey`

## TRACK B — Credentials

### Task B1: Temp-password utility

**Files:**
- Create: `packages/platform/src/credentials/temp-password.ts`, `temp-password.test.ts`
- Modify: `packages/platform/src/index.ts` (export)

**Interfaces:**
- Produces: `generateTemporaryPassword(length?: number): string` — default length 10.

- [ ] **Step 1: Write the failing test**

```ts
import { generateTemporaryPassword, TEMP_PASSWORD_ALPHABET } from "./temp-password";

it("uses only the unambiguous alphabet", () => {
  for (let i = 0; i < 500; i += 1) {
    for (const ch of generateTemporaryPassword()) {
      expect(TEMP_PASSWORD_ALPHABET).toContain(ch);
    }
  }
});

it("excludes visually ambiguous characters", () => {
  for (const ch of "0O1lI") expect(TEMP_PASSWORD_ALPHABET).not.toContain(ch);
});

it("honours the requested length and defaults to 10", () => {
  expect(generateTemporaryPassword()).toHaveLength(10);
  expect(generateTemporaryPassword(16)).toHaveLength(16);
});

it("does not repeat across draws", () => {
  const seen = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
  expect(seen.size).toBe(200);
});
```

- [ ] **Step 2: Run and confirm failure.** `npx vitest run --project unit temp-password`

- [ ] **Step 3: Implement**

```ts
import { randomInt } from "node:crypto";

/**
 * Temporary-password generation (#11 D1, owner-ratified).
 *
 * This deliberately sits OUTSIDE packages/modules/identity/src/core/: that
 * boundary exists for primitives whose parameter quality cannot be proven by
 * tests (argon2 cost, session signing). Drawing uniformly from a fixed
 * alphabet has no such tunable — it is auditable in full, right here.
 *
 * randomInt is the CSPRNG with rejection sampling built in, so the draw is
 * uniform; a naive randomBytes % alphabet.length would bias toward the first
 * characters. The alphabet omits 0/O/1/l/I because these passwords get
 * PRINTED on a sheet and typed by a student from paper.
 */
export const TEMP_PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTemporaryPassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}
```

- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** — `feat(platform): temporary password generation`

### Task B2: Credential service

**Files:**
- Create: `packages/modules/identity/src/service/credential-service.ts` + test
- Modify: `packages/modules/identity/src/index.ts` (wire into the assembled module)

**Interfaces:**
- Produces: `issueCredential(input: { personName: string; username: string; collegeId: string; roles: readonly Role[]; createdBy: string }): Promise<{ username: string; temporaryPassword: string }>`

**Constraint:** the account must end **active** so the holder can log in (D2 / e2e guard (b)) — `createUser` alone leaves it `must_reset`, which login rejects. Reuse `users-service.createUser` then `adminSetPassword`; do **not** add a repo path or touch `core/`.

- [ ] **Step 1: Write the failing tests**

```ts
it("issues an ACTIVE account that can log in", async () => {
  const issued = await service.issueCredential(input);
  const user = await repo.findByUsername(issued.username);
  expect(user?.status).toBe("active");   // NOT must_reset — login rejects that
});

it("returns the plaintext exactly once and never stores it", async () => {
  const issued = await service.issueCredential(input);
  expect(issued.temporaryPassword).toHaveLength(10);
  const user = await repo.findByUsername(issued.username);
  expect(JSON.stringify(user)).not.toContain(issued.temporaryPassword);
});
```

- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.** Document at the seam **why** the account is active and that force-change is a recorded gap (D2), pointing at the spec.
- [ ] **Step 4: Run tests** → PASS. Then prove the boundary: `git diff --stat packages/modules/identity/src/core/` must be **empty**.
- [ ] **Step 5: Commit** — `feat(identity): credential issuance service`

### Task B3: Credential sheet PDF

**Files:**
- Create: `packages/modules/reporting/src/render/credential-sheet.ts` + test
- Modify: `packages/modules/reporting/src/definition.ts` (add report kind `class-credentials`), `report-data.ts`, `service/report-service.ts`

- [ ] **Step 1: Write the failing test** asserting the renderer returns a non-empty `Buffer` starting with `%PDF`, and that one page is emitted per class.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement** with `pdfkit`, mirroring `render/pdf.ts` conventions (A4, margin 48, the same ink/muted/rule constants). One page per class; cut-line layout; columns roll no / name / username / temp password; first-login instructions in the footer.
- [ ] **Step 4: Add the report kind** to the discriminated union and the service switch, admin-only.
- [ ] **Step 5: Run tests, `pnpm openapi:generate`** → PASS.
- [ ] **Step 6: Document the sensitivity.** Add to `SECURITY.md` under the deferred/known list: the credential sheet is a durable artifact in object storage containing plaintext temporary passwords; generation is admin-only and audited; short retention recommended. **This is spec Risk 1 — do not skip it.**
- [ ] **Step 7: Commit** — `feat(reporting): per-class credential sheet PDF`

### Task B4: Wire issuance into import + standalone action, and E2E guard (b)

**Files:** Modify the import confirm path to issue credentials for students lacking them; add a per-class "Generate credentials" action and an individual staff action. Create `tests/e2e/credentials.spec.ts`.

- [ ] **Step 1: Write the journey** — generate a class credential sheet, assert a PDF artifact is produced, then **log in as a newly created student with the generated credential** and land on the portal.
- [ ] **Step 2: Run against a running app** (worker required).
- [ ] **Step 3: Commit** — `test(e2e): assignment #11 credential journey`

**Phase 2 gate:** both tracks' unit/ui suites green, typechecks clean, and the 26 existing e2e journeys unchanged and passing.

---

# PHASE 3 — Two halves, parallel

## Half 1 — Help content

### Task 10: Write the 15 help docs + guard (c)

**Files:** Create `content/help/college/*.md` ×15; create `tests/e2e/help.spec.ts`.

Screens: attendance · marks · student add/import · fees collection + receipt · exams setup · timetable · notices · leave · reports · user management · backups/system · login/first steps · portal overview · coursework · analytics.

- [ ] **Step 1: Write each doc** — plain language, numbered steps, exactly one screenshot placeholder (`> _screenshot: ..._`). No Hindi/Marathi (out of scope, flagged).
- [ ] **Step 2: Pass `helpSlug` on each of those 15 screens' `PageHeader`.**
- [ ] **Step 3: Re-run the compiler** and confirm the missing-doc warning now lists only screens outside the 15.
- [ ] **Step 4: Write guard (c)** — help SlideOver opens on the attendance screen and shows real content.
- [ ] **Step 5: Commit** — `docs(help): v1 help content for the 15 core screens`

## Half 2 — Onboarding

### Task 11: Preferences table and routes

**Files:**
- Modify: `packages/modules/system/src/db/schema.ts`, `definition.ts`, `api/handlers.ts`
- Create: `packages/modules/system/migrations/0001_user_preferences.sql` + `.down.sql`
- Create: `apps/web/app/api/v1/system/preferences/[key]/route.ts`
- Test: `packages/modules/system/src/api/handlers.test.ts`

**Interfaces:**
- Produces: `GET`/`PUT /api/v1/system/preferences/{key}`, `ANY_AUTHENTICATED`, **always scoped to the caller's own `principal.id`** — the user id is never taken from the request.

```sql
CREATE TABLE sys_user_preferences (
  user_id    uuid NOT NULL,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
```

- [ ] **Step 1: Write the failing test** — a user reads and writes their own key; **a second user's identical key is invisible to them** (this is the security property; assert it explicitly).
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Write the migration and schema** (`sys_` prefix — `scripts/check-table-ownership.ts` enforces it).
- [ ] **Step 4: Implement handlers.** `PUT` is state-changing → it **must** declare an audit action.
- [ ] **Step 5: Run tests, migrate, `pnpm openapi:generate`** → PASS.
- [ ] **Step 6: Commit** — `feat(system): per-user keyed preferences`

### Task 12: Onboarding checklists + guard (d)

**Files:** Create `apps/web/src/ui/OnboardingChecklist.tsx` + test; modify `apps/web/app/(app)/dashboard/page.tsx`; create `tests/e2e/onboarding.spec.ts`.

- [ ] **Step 1: Write failing UI tests** for per-role item sets and for auto-check (students exist ⇒ "import students" checked).
- [ ] **Step 2: Implement.** ADMIN: change password → academic structure → import students → import staff → fee structure → print credentials. TEACHER: timetable → first attendance → marks. STUDENT: attendance/marks/fees. Dismissible, persisted via Task 11. Every item deep-links.
- [ ] **Step 3: Run ui suite** → PASS.
- [ ] **Step 4: Write guard (d)** — admin checklist renders and items deep-link.
- [ ] **Step 5: Commit** — `feat(web): first-run onboarding checklists`

---

## Final verification (spec exit criteria)

- [ ] Full e2e: 26 existing journeys **unchanged and green** + 4 new guards (a–d).
- [ ] The `bulk-import` BullMQ completion log, captured.
- [ ] The generated credential sheet PDF, attached.
- [ ] The list of 15 help docs written.
- [ ] `git diff --stat`, plus **`git diff --stat f36956a..HEAD -- packages/modules/identity/src/core/` proving it is empty.**
- [ ] An explicit statement of both STOP conditions hit (spec findings 1 and 2) and how each was resolved (D1, D2).
- [ ] Measure and report the import's true row ceiling (spec Risk 3). If it falls short of 5,000 rows, **escalate rather than silently accept it.**
- [ ] Write the evidence bundle to `docs/assignment-11/a11-evidence.md`, mirroring `docs/assignment-10/a10-evidence.md`.
