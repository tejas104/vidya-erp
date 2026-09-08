# Vidya — System Architecture & Workflow Reference

> The single orientation document: what the product is, how the system is layered,
> how every role experiences it, and the full build roadmap. Companion to
> `docs/superpowers/plans/2026-07-11-erp-master-plan.md` (the execution program).

---

## 1. Product vision

Vidya is a **Zoho-class college ERP**: one system covering academics, finance,
communication, library, hostel/transport and placement, sellable two ways:

- **On-prem** — a college runs the whole stack (Docker Compose: Postgres, Redis,
  MinIO, web, worker) on its own hardware; a signed license file unlocks features.
- **SaaS** — one deployment hosts many colleges; `college_id` is the tenant key on
  every row, and the licensing layer becomes the subscription/plan gate.

Design identity: an editorial "paper & chalk" aesthetic — a hand-rolled design
system, not a component library. Every screen is role-gated, every write audited,
every read scope-checked. Deny-by-default everywhere.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces | zero-cost module isolation |
| Web | Next.js 16 (App Router, Turbopack), React, TypeScript strict | one app: UI + API routes |
| API style | REST `/api/v1/<module>/…`, zod-validated, problem+json errors | uniform pipeline, OpenAPI-able |
| DB | PostgreSQL + Drizzle ORM, per-module SQL migrations (up/down) | constraints enforce invariants in the DB |
| Jobs | BullMQ on Redis, separate `apps/worker` | reports, invoice generation, future digests |
| Files | MinIO (S3 API) via platform ObjectStorage helpers | materials, submissions, report PDFs |
| Auth | Cookie sessions, argon2id, two independent login brakes (see below) | human-owned core (ADR-0012) |
| Observability | Prometheus metrics (:9464), structured pino logs, audit table | runbook-driven ops |
| Tests | Vitest (unit + jsdom UI projects), RTL, Playwright drives | 500+ unit, 58 UI, live E2E per module |
| PDF | pdfkit (ADR-0021) | reports without headless Chrome |

**Two login brakes, deliberately separate.** Both answer HTTP 429, so any
diagnosis must distinguish them by response *shape*, never by status alone:

| | Rate limiter | Account lockout |
|---|---|---|
| Counts | every login **request** (success included) | consecutive **credential failures** |
| Keyed by | source IP *and* username, independently | username alone (#10.5 Part 2 — never the IP) |
| Lives in | `packages/platform/src/ratelimit/limiter.ts` | `packages/modules/identity/src/service/throttle.ts` |
| Wired at | `defineRoute` (`packages/platform/src/http/define-route.ts`), from `apps/web/src/composition.ts:392` — **before** the handler runs | inside `AuthService.login`, i.e. only for requests the limiter let through |
| Opted into by | `RouteSpec.rateLimit` (5 routes, all in `identity/src/definition.ts`) | always, on `identity.login` |
| Defaults | login-IP 10/60s then exponential backoff to 30 min; login-username 5/60s; password 3/60s; session 300/60s | 10 consecutive failures → 15 min lock |
| 429 shape | problem+json, `title: "Too many requests"`, variable `retry-after` (a Redis TTL) | plain json `{message: "too many failed attempts…"}`, `retry-after` always exactly `900` |

Because the per-username limiter (5/60s) is stricter than the lockout
threshold (10), a rapid burst against one account trips the *limiter* and
never reaches lockout — reaching genuine lockout takes failures spaced across
the limiter's window. Proof of each, separately: `tests/e2e/security.spec.ts`
guards (a) and (b); `tests/integration/identity-flow.int.test.ts` proves the
lockout subject ignores the source IP.

> **Config footgun:** `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` do **not**
> configure login — despite the names they feed the *reset-token redemption*
> throttle (`config.identity.throttle`). Login lockout is
> `LOGIN_LOCKOUT_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_WINDOW_MINUTES`; the limiter is
> the `RATE_LIMIT_*` family (`packages/platform/src/config/env.ts`).

**House invariants** (non-negotiable):
1. No new runtime dependency without an ADR (`docs/adr/0009`).
2. Modules import each other **only** via public `index.ts` surfaces.
3. Every row carries its **org-path columns** (`college_id`, `department_id`,
   `class_id`, `section_id` as applicable) stamped at write time — scope checks
   never join across modules.
4. `college_id` = tenant key on every table (SaaS-ready from day one).
5. Money is **integer paise**, never floats; display converts at the edge.
6. Every mutating route declares an `audit` action; the pipeline writes the log.
7. New roles follow the **role recipe** (§6).

---

## 3. System architecture — layers and request flow

```
┌────────────────────────────────────────────────────────────────────┐
│  CLIENT — Next.js app shell                                        │
│  (app)/ layout: role-gated nav (navConfig.ts) + design system      │
│  api.ts typed client → fetch /api/v1/…                             │
└───────────────▼────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────┐
│  ROUTE PIPELINE — packages/platform defineRoute (every request)    │
│  1. requestId + logging          5. handler (module code)          │
│  2. session → Principal          6. audit write (if mutating)      │
│  3. auth requirement (roles)     7. problem+json on any error      │
│  4. zod validate params/query/body                                 │
│  [M11 adds step 2.5: license gate — RouteSpec.feature checked      │
│   against the verified license's feature set → 402/403 if absent]  │
└───────────────▼────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────┐
│  MODULES — packages/modules/* (one directory = one bounded context)│
│  system • identity • people • academics • analytics • reporting    │
│  portal • timetable • coursework • fees(WIP) • …roadmap §7         │
│  Each: definition.ts (RouteSpecs+JobSpecs) / handlers / repo /     │
│        db/schema.ts / migrations / index.ts (public surface)       │
│  Cross-module reads go through injected read-model interfaces      │
│  (PeopleDirectory, AnalyticsReadModel, TimetableReadModel).        │
└───────────────▼────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────┐
│  PLATFORM — packages/platform                                      │
│  auth (ROLES, ScopeChecker seam, OrgPath) • db (Drizzle) •         │
│  storage (S3 helpers) • metrics • job queue seam • http pipeline   │
└───────────────▼────────────────────────────────────────────────────┘
┌──────────────┬──────────────┬──────────────┬───────────────────────┐
│ PostgreSQL   │ Redis/BullMQ │ MinIO (S3)   │ apps/worker           │
│ (constraints │ (job queue)  │ (files)      │ (jobProcessors from   │
│  = law)      │              │              │  the same modules)    │
└──────────────┴──────────────┴──────────────┴───────────────────────┘
```

**Composition roots** (`apps/web/src/composition.ts`, `apps/worker/src/main.ts`)
instantiate every module once with its deps and register routes/job processors.
The web runtime is memoized on `globalThis` → **restart web after composition
changes** (`rm -rf apps/web/.next` if routes changed).

### Security model

- **Roles**: `admin, principal, hod, class_teacher, teacher, student, accountant`
  (+ future `librarian, placement_officer, parent` — §7).
- **Grants matrix** (identity module): a grant = (role, org scope, optional
  subject). `grantAllows` is a fail-closed switch per role — e.g. teacher writes
  only their subject's records; hod reads a department; accountant reads
  college-wide but writes only `fees` records; admin writes only
  identity/people (never academic marks). Students hold **no grants** — their
  authority is the identity↔student link (self-scope), same for teacher
  self-routes (`my-today`, `my-fees`…). Self routes never accept an id.
- **Disclosure gates**: analytics/reporting enforce minimum-cohort and at-risk
  field-gating; reports are scope-checked downloads (never URL-secret); CSV
  cells are formula-injection-escaped (ADR-0020).
- **Tenancy**: every query filters by the caller's college via org-path columns;
  M12 adds an automated cross-tenant test suite.

### Licensing layer (M11 — designed, not yet built)

- A license file = JSON claims (collegeIds, plan, feature list, expiry, seat
  caps) **signed with ed25519**; public key ships in the binary, private key
  stays with the vendor. No phone-home required (on-prem friendly).
- `RouteSpec.feature?: string` — the pipeline rejects routes whose feature is
  not in the verified license (`402 payment-required` problem+json).
- UI reads `/api/v1/system/license` to hide unlicensed nav entries.
- SaaS mode: the same claims come from a subscriptions table instead of a file —
  one gate, two sources.

---

## 4. Frontend — the app shell and how users act

**Shell**: left sidebar (grouped, role-filtered nav from `navConfig.ts`), top bar
(college name, academic-year picker, theme toggle, user menu), content area with
`PageHeader → Cards/DataTables`. Kit: PageHeader, Card, Button, Field, Modal
(focus-trapped), ConfirmDialog, Menu, Toast, DataTable, Badge, EmptyState,
Skeleton, Tabs, chart primitives. Mobile: sidebar collapses to a sheet.

**Login flow (all roles)**: `/login` → session cookie → redirect by role:
students → `/portal`, staff → `/dashboard`. The dashboard is role-aware — the
same route renders different tiles per the caller's grants.

### 4.1 Teacher — a working day

1. **Login → /dashboard**: "Today" card (their timetable periods today, from
   `timetable.my-today`), their class tiles (subject, section, attendance %,
   recent marks distribution), at-risk flags for their students.
2. **Take class → /manage/attendance** (class_teacher) — pick section + date,
   roster loads, mark present/absent/leave, save (one audited write; corrections
   allowed same-day per academics rules).
3. **Enter marks → /manage/marks** — create assessment (subject they hold a
   grant for), enter scores in the grid, save. Scope checker blocks other
   subjects' records.
4. **Coursework → /manage/coursework** — pick a class tile: create assignment
   (title, instructions, due date, max score), upload study material (≤1 MB
   file), see submissions count, open Evaluate modal → score + feedback per
   student (locks the student's resubmission), delete assignment (blocked with
   409 once submissions exist).
5. **Timetable → grid view** of their week; clash-free by DB constraint.
6. Future (§7): apply leave (M7), see notices (M3), message HOD (M7),
   exam duty (M6).

### 4.2 Student — the portal (`/portal`)

Single self-scoped page (no ids in URLs — everything derives from the identity
link): profile header (name, admission no, class/section) • **attendance** by
month with percentage ring • **marks** by assessment • **weekly timetable**
grid • **assignments** (pending/submitted/scored badges; Submit modal with
text + optional file; resubmission allowed until evaluated, then locked) •
**study material** (download links) • *(M4)* **fees** — invoices with dues,
status badge, payment/receipt history • *(M3)* notices feed • *(M5)* semester
results + GPA card • *(M6)* exam hall ticket/schedule.

### 4.3 Admin (college office / super admin)

**/dashboard**: college KPIs. **Administration group**: `/manage/org` (college →
department → class → section tree CRUD) • `/manage/students` (create, enroll,
browse rosters) • `/manage/teachers` (create, link login, subject assignments) •
`/manage/users` (logins, roles, grants — the authority matrix UI) •
`/manage/import` (CSV bulk load with worker-processed runs + error reports) •
`/manage/timetable` (period template + section grids; 409s name the busy
resource) • *(M4)* `/manage/fees` (heads, class structures, generate invoice
runs) • *(M13)* super-admin console: license status, audit viewer, backups,
sys-settings, reports catalog.

### 4.4 Accountant (M4, in flight)

Login → fees-focused dashboard: today's collections, dues aging. **/manage/fees →
Collect tab**: find student/section → invoice list with live dues (ledger math:
`invoice + fines − scholarships − waivers − payments + refunds`) → Record
payment modal (amount ₹, mode cash/upi/card/bank/gateway, ref) → **gap-free
receipt number** issued transactionally → print/PDF receipt (M13 report).
Adjustments modal: scholarship/fine/refund/waiver (waiver resolves the invoice).
Defaulters table (chase list) and collections-by-mode summary for
reconciliation. Accountant writes are confined to fees records by `grantAllows`.

### 4.5 HOD / Principal

Read + approve surfaces: department (HOD) or college (principal) dashboards —
attendance/marks trends, at-risk cohorts, teacher coverage, report exports.
HOD's only write verb is `approve` (leave M7, marks-change requests M5).
Principal adds notices-publish (M3) and sees fees summaries (M4) + placement
stats (M10).

### 4.6 Future roles (see §7)

**Librarian** (M8): issue/return desk, catalog, fine postings into the fees
ledger. **Placement officer** (M10): companies, drives, eligibility filters,
offers. **Parent** (M14): read-only mirror of a linked student's portal +
fee-pay hooks.

---

## 5. What exists today (merged to `main`)

| Area | State |
|---|---|
| Platform pipeline, auth, grants, audit, metrics, migrations, worker, storage | ✅ since rounds 1–2 |
| Analytics dashboards (role-aware, disclosure-gated, charts) | ✅ |
| Manage: attendance, marks, org, students, teachers, users, CSV import, reports inbox (PDF/CSV) | ✅ |
| App shell + hand-rolled design system (paper/chalk themes) | ✅ |
| Student portal + `student` role self-scope link | ✅ |
| M1 Timetable: period template, clash-proof entries (DB constraints), teacher Today, portal weekly grid | ✅ |
| M2 Coursework: assignments, submissions (resubmit-lock), materials w/ raw-byte downloads, evaluate flow | ✅ (`ae2da1c`) |
| M4 Fees core: schema, money math (12 tests), repo (receipt counter tx), 13 route defs, **accountant role** | 🚧 WIP `65165dc` on `feature/fees` |

Gates at last merge: **500 unit + 58 UI tests, 12-package typecheck, live
Playwright drives, clean consoles.** Demo stack: `localhost:3000` (web),
`:9464` (worker metrics); demo users `demo-admin`, `demo-teacher-*`,
`demo-student`, (soon `demo-accountant`).

---

## 6. The role recipe (repeatable procedure)

Adding any new role (used for `student`, `accountant`; next: `librarian`,
`placement_officer`, `parent`):

1. `packages/platform/src/auth/types.ts` → append to `ROLES`.
2. Identity migration widening `idn_user_roles_role_check`.
3. `identity/src/definition.ts` grant `superRefine` case (what scope shape the
   role's grants may take — or "no grants, self-scoped").
4. `identity/src/core/scope-checker.ts` `grantAllows` case — **fail closed**,
   narrowest write surface that works.
5. `apps/web/src/ui/api.ts` `Role` union + navConfig entries.
6. Seed a demo user; add module routes gated `rolesAnyOf`.

---

## 7. Future workflow — the merge train (M3 → M14)

Order optimizes dependency flow and demo value. Each module = one branch, DoD =
migrations up/down + scope-checked routes + UI + unit/RTL tests + live drive +
gates green → fast-forward merge.

| # | Module | Scope (entities → workflow) |
|---|--------|------------------------------|
| **M4** | **Fees** (finish) | handlers + invoice-generate worker job + `/manage/fees` + portal fees. Workflow: admin defines heads/structures → worker generates invoices per enrolled student (idempotent) → accountant collects/adjusts → student sees dues live → defaulter + collection reports. |
| **M3** | **Notices** | `ntc_notices` (title, body, audience: college/dept/class/section/role, publish window, attachment). Principal/admin/hod publish → banner + feed on dashboard & portal → read-receipts count. |
| **M5** | **Results/GPA** | semester result compilation from academics marks: grade bands, SGPA/CGPA, publish gate (principal approves → students see), marksheet PDF (reporting), transcript. |
| **M7** | **Leave & Messages** | staff leave requests → HOD approve/reject chain with balances; student leave notes → class teacher; simple internal threads (no external email). |
| **M6** | **Exams** | exam definitions, timetable (reuses clash machinery), seating/hall tickets (PDF), invigilation duty, marks feed into M5. |
| **M8** | **Library** | `librarian` role; catalog (title/copies/barcode), issue/return desk, due dates, fines post **into the fees ledger** (one money system), member history. |
| **M10** | **Placement** | `placement_officer` role; companies, drives (eligibility by CGPA/dept from M5), student applications, offer tracking, placement stats for principal. |
| **M9** | **Hostel & Transport** | rooms/beds + allocation; routes/stops + assignment; both post charges into fees. |
| **M11** | **Licensing** | ed25519-signed license file, `RouteSpec.feature` gate in the pipeline, license admin screen, gates by plan tier (see §3). |
| **M12** | **SaaS hardening** | automated cross-tenant isolation test suite, `sys_settings`, backup/restore scripts + runbook, audit-log viewer UI, retention. |
| **M13** | **Reports catalog & Super-Admin** | one catalog screen for every report (fees receipts/collections, results, attendance registers, library, placement), super-admin console (license, audit, backups, settings). |
| **M14** | **Parents** | `parent` role linked to student(s); read-only portal mirror + fee visibility; groundwork for payment gateway. |

**Cross-cutting after M14 / continuous**: performance passes (indexes, query
budgets in `docs/performance.md`), accessibility sweep, seed-data realism,
OpenAPI export, backup drills.

---

## 8. Important details (operational memory)

- **Run**: Docker Compose for Postgres/Redis/MinIO; `pnpm --filter web dev`
  (:3000) + worker; `tsx scripts/migrate.ts up`; `tsx scripts/seed-demo.ts`.
- **Restart discipline**: web memoizes composition on `globalThis` — after
  touching composition/module wiring: kill :3000, `rm -rf apps/web/.next`,
  relaunch. Worker likewise on :9464.
- **Shared-file law** (multi-module edits): append-only marked blocks
  (`// --- <module> ---`) in `api.ts`, `navConfig.ts`, both composition roots,
  `scripts/registry.ts`, package.jsons, seed script.
- **Gates**: `pnpm test` (unit), `pnpm test:ui`, `pnpm -r typecheck`, live
  Playwright drive per module. Never merge red.
- **pg error unwrap**: `(e).code ?? (e).cause?.code` (DrizzleQueryError wraps).
- **Binary responses**: return `{status, body: Uint8Array, contentType}` —
  top-level `contentType`, not a header, or the body gets JSON-stringified.
- **useEffect deps**: depend on stable string ids, never recomputed objects
  (infinite-refetch class of bug — hit twice).
- **Program of record**: `docs/superpowers/plans/2026-07-11-erp-master-plan.md`;
  session ledger + resume points: `.superpowers/sdd/progress.md` (gitignored,
  local). Subagents don't survive this account's session caps — build inline.
