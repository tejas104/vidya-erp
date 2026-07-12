# Vidya ERP — Master Plan v2 (frontend-first, must-have core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> This is the **program-level plan**. Each module below is one branch and gets
> its own detailed bite-sized plan (house pattern: complete code, TDD) generated
> at execution start — the contracts, screens, and states below are **binding**
> for those plans. Supersedes `2026-07-11-erp-master-plan.md` where they differ.
>
> Sources: `docs/architecture-and-workflows.md` (vision), the 2026-07-11 master
> plan (module inventory + DoD), and the owner's **VEFS document**
> (`vidya_school_college_erp.txt`) — reconciled in the section below.

**Goal:** Finish Vidya into a sellable college-ERP core — fees, notices, results, exams, leave, licensing, hardening, reports — each module built UI-first inside "The Register" design system, merged one at a time with gates green.

**Architecture:** Per module the order is **contract → frontend → backend → integration**: `definition.ts` (zod RouteSpecs) is written first and is the interface; the UI + typed `api.ts` client are built against it with RTL/mocked fetch; then handlers/repo/migrations make the contract real; then composition wiring, seed data, and a live Playwright drive close it. Every merge ships working software.

**Tech Stack:** Existing only — Next.js 16 App Router, React, TS strict, Drizzle/Postgres, BullMQ/Redis, MinIO, pdfkit, Vitest/RTL/Playwright. **No new runtime dependencies** (ADR-0009).

## Global Constraints (house invariants — every task inherits these)

1. No new runtime dependency without an ADR (`docs/adr/0009`).
2. Modules import each other **only** via public `index.ts` surfaces; cross-module reads via injected read-model interfaces.
3. Every row carries org-path columns (`college_id`, `department_id`, `class_id`, `section_id` as applicable) stamped at write time.
4. `college_id` = tenant key on every table.
5. **Money is integer paise, never floats**; display converts at the edge.
6. Every mutating route declares `audit`; errors are problem+json; `pgErrorCode` unwraps `DrizzleQueryError.cause`.
7. New roles follow the role recipe (`docs/architecture-and-workflows.md` §6).
8. UI: kit components only (PageHeader, Card, DataTable, Modal, ConfirmDialog, Field, Badge, Tabs, Toast, EmptyState, Skeleton, charts), both themes, designed empty/error/withheld states, `:focus-visible`, reduced-motion respected. Copy: plain, active, user's side of the screen.
9. Shared-file law for parallel work: append-only `// --- <module> ---` blocks in `api.ts`, `navConfig.ts`, `Icon.tsx`, `composition.ts`, `apps/worker/src/main.ts`, `scripts/registry.ts`, `scripts/seed-demo.ts`.

## Scope ruling (what "must-have ERP" means here)

**In (the sellable core):** M4 Fees · M3 Notices · M5 Results/GPA · M6 Exams · M7 Staff leave (approvals only) · M11 Licensing · M12 Tenancy/ops hardening · M13 Reports catalog + super-admin home.

**Cut from previously-planned scope** (each is additive later, nothing blocks on them):
- M8 Library, M9 Hostel/Transport, M10 Placement, M14 Parents/online-classes — real modules, not core; they slot into the same recipe post-v1.
- M7 messaging threads & student complaints — colleges have phones/WhatsApp; leave approvals are the ERP part.
- M3 read-receipts and events-calendar — a notice feed is the must-have; calendar rides on M6 exam slots.
- M6 quiz — assessments already exist in academics.
- M12 email/SMS/gateway provider config UI — online payment is post-v1; `sys_settings` lands only when a consumer exists.
- QR attendance, documents module — out entirely for v1.

## Reconciliation with the VEFS document

The VEFS text proposes a 10–15-volume functional spec. What this plan **adopts** from it:

1. **The dashboard rule** (VEFS Vol 1 Ch 1): *a teacher never lands on an empty dashboard* — it must answer "what do I teach today, what's pending, who needs attention" in ten seconds. Adopted as a cross-cutting UI principle and built in Phase 5.5 (Today card exists via `timetable.my-today`; pending-tasks card is new).
2. **The Class Workspace** (VEFS Vol 1 Ch 6): one per-class hub instead of hopping between Attendance → Marks → Coursework. This is the document's best idea and is **pure frontend composition** of modules that already exist — no new backend. Planned as Phase 5.5.
3. **Workspace anatomy as a checklist**: every screen spec in this plan already defines purpose, entry conditions, states, permissions, and edge cases — the VEFS chapter skeleton, kept at sane depth.
4. **Attendance shortage guidance** (VEFS Vol 2 Ch 2): "attend the next N classes to reach 75%" on the portal — one pure function on data the portal already loads; folded into Phase 5.5.

### VEFS coverage map (volume/chapter → where it lands)

| VEFS section | Disposition |
|---|---|
| V1 Ch1 Teacher login & dashboard | Login, shell, role-gated nav, Today card: **built** (main). Pending-tasks card: **Phase 5.5**. Role switcher, first-time wizard, notification center, global search: **rejected** (nav + per-page search suffice at this scale). |
| V1 Ch2 Attendance workspace | Core grid + same-day corrections: **built**. Correction approval chain, late/medical/on-duty statuses: **deferred backlog**. QR/RFID/face, drafts, smart assistance: **rejected**. |
| V1 Ch3 Assessment & marks | Assessments + marks grid: **built** (academics). Rubrics, moderation, viva/practical sub-grids, drafts: **rejected**. Publication gate arrives with **Phase 3** results. |
| V1 Ch4 Assignments & coursework | Full lifecycle incl. resubmit-lock, materials: **built** (M2, `ae2da1c`). Plagiarism, groups, milestones, voice/video feedback: **rejected**. |
| V1 Ch5 Student 360° workspace | Roster with attendance/marks metrics: **Phase 5.5 Students tab** + existing students page/analytics. Behavior, mentoring, counseling, parent-comms CRM: **rejected**. |
| V1 Ch6 Class Workspace | **Adopted — Phase 5.5** (the document's best idea; pure frontend composition). |
| V1 Ch7 Timetable & schedule | Grid, my-today, clash-proofing: **built** (M1). Meetings, office hours, teaching-load analytics, substitutions: **rejected/deferred**. |
| V1 Ch8 Examination workspace | Series + slots + hall tickets + schedule: **Phase 4 (M6)**. Question banks, invigilation console, malpractice, moderation, revaluation: **rejected**. |
| V1 Ch9 Lesson planning / teaching journal | **Rejected** (accreditation tooling, not core operations). |
| V2 Student portal (all chapters) | Dashboard, attendance, assignments, timetable, materials: **built**. Fees: **Phase 1**. Results/GPA + grade card: **Phase 3**. Exams + hall ticket: **Phase 4**. Shortage guidance ("attend next N"): **Phase 5.5**. Documents/certificates, student leave: **deferred**. |
| V4 Principal portal | Role-aware analytics dashboards: **built**. Approvals: leave **Phase 5**, results publish **Phase 3**. Fee summary tile: **Phase 1**. |
| V5 Admin portal | Users/roles/grants, org structure, imports, reports inbox: **built** (Areas B–D). Audit viewer + backups: **Phase 7**. Reports catalog + assembled home: **Phase 8**. Notification/template management, branding: **deferred**. |
| Finance volume | **Phase 1 (M4)** — heads, structures, invoices, counter, receipts, adjustments, defaulters, collections. Payroll, inventory, scholarships-as-module: **deferred/rejected**. |
| Library / Hostel / Transport / Placement / Parents volumes | **Deferred backlog** — real modules, not core; each posts money into the one fees ledger when it lands. |
| Automation engine, AI features, notification matrices | **Rejected** for v1. |

What this plan **rejects** from it (per the owner's must-have-only ruling): QR/RFID/face-recognition attendance, plagiarism/AI-content scoring, rubric engines, question banks, Bloom's/CO-PO accreditation mapping, moderation/revaluation/malpractice chains, voice/video feedback, group-assignment engines, project milestone tracking, lesson planning/teaching journals, meetings/office-hours booking, counseling/behavior CRM, first-time-login wizards, per-class settings, notification channel matrices (email/SMS/WhatsApp), and every "Future AI Features" list. Each is additive later; none blocks the sellable core. The 2,000-page-spec approach itself is also rejected — the contract-first recipe (zod RouteSpecs as the binding spec) gives the same "Claude stops guessing" property at ~1% of the weight.

**Why frontend-first per module (not all frontends then all backends):** building every screen before any handler would mean months of unmergeable WIP and no live verification. The contract sandwich gives the same benefit — the UI is designed and built first, against the frozen zod contract — while every branch still merges as working software.

## The per-module recipe (applies to every module below)

Each module executes these five phases in order; its detailed plan expands them into TDD steps:

1. **Contract** — `packages/modules/<mod>/src/definition.ts`: RouteSpecs with zod request/response schemas, auth requirements, audit actions. This freezes the interface. Commit.
2. **Frontend** — append typed client block to `apps/web/src/ui/api.ts`; build screens under `apps/web/app/(app)/…` with kit components; every state designed (loading Skeleton, empty, error toast, denied/withheld). RTL tests with mocked fetch (house pattern: `*.test.tsx` beside the kit). Commit per screen.
3. **Backend** — `db/schema.ts` + `migrations/NNNN_<mod>.sql` (+ `.down.sql`), `repo.ts`, `handlers.ts` implementing the contract; unit tests happy + denial + conflict paths. Commit per route group.
4. **Integration** — `index.ts` public surface; wire `composition.ts` (+ `apps/worker/src/main.ts` if jobs), `scripts/registry.ts`, nav entries, seed data in `scripts/seed-demo.ts`; regenerate OpenAPI; live Playwright drive per affected role with screenshots; zero console errors.
5. **Merge** — gates green (typecheck, lint, unit, UI, drive) → ff-merge to main → ledger update.

---

## Phase 1 — M4 Fees (finish; in flight on `feature/fees`)

Backend core already committed (`65165dc`): schema, money math, repo with transactional receipt counter, 14 route defs (count them in `definition.ts` — the vision doc says 13, it's 14), `accountant` role. Remaining: handlers + worker job (backend), all UI (frontend), wiring (integration). Because the contract already exists, frontend proceeds immediately.

**The design brief (binding for the UI):** the subject is the **fee counter** — the accountant's window where a student pays and walks away with a receipt. Single job of the screen: *"take this payment, hand over the receipt, fast."* Fees is the most ledger-native module in the system, so it leans hardest on the existing Register language: rules divide rows, IBM Plex Mono carries every figure, and money renders as `₹1,23,450.50` (Indian grouping, `Intl.NumberFormat("en-IN")`, always from paise at the edge).

**Signature element (the one bold thing):** the **receipt counterfoil**. After a payment is recorded, the confirmation is not a toast alone — a slip renders in the modal styled as a counterfoil: dashed perforation rule on top, big mono receipt number, amount in figures *and in words* (Indian receipt convention), mode chip, received-by + timestamp. Everything else on the page stays quiet. (Amount-in-words is a small pure function — `formatPaiseInWords` — unit-tested alongside money.ts.)

**Status encoding (no new hues):** `paid` → Badge good · `part` → mono fraction "₹6,000 / ₹10,000" + Badge warn · `pending` past `dueOn` → Badge accent ("overdue") · `waived` → neutral Badge. Colour never alone; the badge text carries the state.

### Screens

**`/manage/fees` (accountant + admin) — Tabs: Counter · Setup · Collections**

- **Counter tab** (default for accountant):
  - Find student: admission-no / name search (people directory endpoint already exists) → student header card (name, class-section, admission no).
  - Invoice ledger `DataTable`: Head · Inst. · Due on · Amount · Paid · Dues · Status · `[Take payment]` (ghost, hidden for `waived`). Rows ruled; figures `.num`.
  - **Record payment Modal**: amount (prefilled with dues, editable), mode select (cash/upi/card/bank/gateway), ref (optional). Submit → counterfoil slip renders in-modal + toast "Receipt #1042 issued." Adjustment action in a row Menu: kind (scholarship/fine/refund/waiver) + amount + reason, ConfirmDialog for waiver ("Waive ₹4,000 for Priya Nair? No further payments will be accepted.").
  - **Defaulters section** below: year-scoped `DataTable` (student, class, head, due on, dues); empty state "No outstanding dues for 2026-27."
- **Setup tab** (admin only — hidden for accountant, server enforces):
  - Fee heads: rules-divided list + add field ("Tuition", "Library", "Lab"); delete blocked with 409 copy "Still used by a structure."
  - Class structures: class picker → `DataTable` (head, year, installment, amount, due on) + create Modal.
  - **Generate invoices**: Button → ConfirmDialog ("Generate invoices for BSc-2 · 2026-27? Students already invoiced are skipped.") → poll run status, progress line "created 142 · skipped 6", failure shows `error` verbatim.
- **Collections tab**: from/to native date inputs → stat tiles (total collected big mono ₹, receipts issued) + by-mode `DataTable` (mode, count, total). Empty: "No collections in this range."

**Portal — Fees section** (`/portal`, self-scoped `my-fees`): dues headline ("Dues: ₹4,500" mono, or "No dues — you're clear for 2026-27"), invoice table with status badges, expandable payment history per invoice (receipt no, mode, date) and adjustments with reasons.

**Dashboard (accountant):** two stat tiles — today's collection (summary endpoint, today..today) and open defaulter count; nav group "Fees" for role `accountant` (+ admin).

### Tasks

- [ ] **F1 — Frontend: api client + Counter tab** — `api.ts` fees block (14 typed methods + `formatPaise`/`formatPaiseInWords`), `apps/web/app/(app)/manage/fees/page.tsx` Counter tab incl. payment modal + counterfoil; RTL: search→ledger render, payment happy path, waived 409 toast, overdue badge. Commit.
- [ ] **F2 — Frontend: Setup + Collections tabs + portal + nav** — setup/generate/poll UI, collections tiles, portal fees section, `navConfig.ts` + accountant redirect (login → `/manage/fees`); RTL per screen. Commit.
- [ ] **F3 — Backend: handlers** — `handlers.ts` for all 14 routes over the existing repo; unit tests: happy, denial (student hitting counter routes 403, accountant scope), 409s (duplicate head/structure, waived-invoice payment), 404s. Commit.
- [ ] **F4 — Backend: invoice-generate worker job** — job processor in fees module registered in `apps/worker/src/main.ts`; idempotency test (re-run creates 0, skips N). Commit.
- [ ] **F5 — Integration** — `index.ts`, `composition.ts`, `registry.ts`, migrations run, seed `demo-accountant` + heads/structures/invoices/part-payments so every state shows; OpenAPI regen; live drive: accountant collects cash → receipt renders; student sees dues drop; admin generates run. Merge.

---

## Phase 2 — M3 Notices

**Brief:** the **staff-room noticeboard**. Single job: *"what has the college announced that applies to me?"* No new metaphor needed — a notice is a dated, rules-divided entry: title (body face, strong), date + audience chip in mono eyebrow, body below. No read receipts, no events table.

**Contract:** `ntc_notices(id, college_id, audience 'college'|'staff'|'students'|'department:<id>'|'class:<id>', title, body, publish_at, expires_at, created_by)`. Routes: create (admin/principal, audited), list-visible-to-me (server filters by role + org path), delete (author/admin, audited).

**Screens:**
- `/manage/notices` (admin/principal): compose Modal (title, body textarea, audience select built from org tree, publish window dates — native inputs); list `DataTable` with status column derived client-side (scheduled/live/expired) as Badge, delete with ConfirmDialog.
- **Noticeboard card** on `/dashboard` and `/portal`: top 5 live notices, "older notices" link expands; empty state "Nothing on the board."

**Tasks:**
- [ ] **N1 — Contract** (`packages/modules/notices/src/definition.ts`). Commit.
- [ ] **N2 — Frontend**: api block, `/manage/notices` page, noticeboard card shared component `apps/web/src/ui/Noticeboard.tsx` used by dashboard + portal; RTL: audience chip render, scheduled vs live, compose validation. Commit.
- [ ] **N3 — Backend**: schema/migration/repo/handlers; unit tests incl. audience filtering per role (student in class X sees class-X + college, not staff). Commit.
- [ ] **N4 — Integration**: wiring, seed 4 notices covering every audience + one scheduled + one expired, drive as admin/teacher/student. Merge.

---

## Phase 3 — M5 Results / GPA

**Brief:** the **printed marksheet**. Single job (student): *"what did I get, and what's my GPA?"* Single job (staff): *"compile, check, publish."* The grade card is the signature: a bordered, mono-figure table that mirrors a university marksheet — subject · credits · grade · points, SGPA/CGPA as the big mono headline. Publication is a hard gate: students see **nothing** until the principal publishes (a designed withheld state, in the house tradition of honest UI).

**Contract:** `res_grade_scales(id, college_id, name, bands jsonb [{min,grade,points}])`, `res_subject_credits(id, college_id, class_id, subject_id, credits, academic_year)`, `res_publications(id, college_id, class_id, academic_year, term, published_at, published_by)`. Routes: scale CRUD (admin), credits set (admin), class-results preview (staff scope; computes from academics read model × credits × scale), publish (principal/admin, audited, ConfirmDialog-worthy), my-results (student self-link, **published only**), grade-card PDF (new reporting kind `grade-card`, scope-checked download).

**Screens:**
- `/manage/results` (admin/principal): three sections — grade scale editor (editable band rows: min %, grade, points; validation: bands cover 0–100, no overlap → inline error copy), credits grid (class picker → subjects × credits inputs, one save), compile & publish (class + term → preview `DataTable` per student: subject grades, SGPA, rank → Publish button, principal-gated, ConfirmDialog "Publish BSc-2 Term 1 results? Students see them immediately.").
- **Portal — Results tab**: per published term a card — SGPA big mono + grade chips per subject; CGPA headline across terms; "Download grade card (PDF)". Unpublished term: "Term 2 results aren't published yet."

**Tasks:**
- [ ] **R1 — Contract** + golden-number spec: fixed marks fixture → expected SGPA/CGPA documented in the plan (correctness anchor). Commit.
- [ ] **R2 — Frontend**: api block, `/manage/results`, portal Results tab; RTL: band-overlap validation, withheld state, publish confirm. Commit.
- [ ] **R3 — Backend**: schema/migrations/repo/handlers; **GPA unit tests against the golden numbers**, publication-gate denial test (unpublished → student 404/empty). Commit.
- [ ] **R4 — Backend: grade-card PDF** — reporting module gains kind `grade-card` (pdfkit, marksheet layout); snapshot-ish test on text content. Commit.
- [ ] **R5 — Integration**: wiring, seed scale + credits + publish Term 1 for demo class, drive: admin compiles → principal publishes → student downloads. Merge.

---

## Phase 4 — M6 Exams

**Brief:** the **exam timetable on the noticeboard**. Single job: *"when and where is each paper?"* Reuses the timetable grid vocabulary (day × slot) so it reads instantly. Hall ticket PDF = the student-facing artifact. Quiz cut (assessments exist).

**Contract:** `exm_series(id, college_id, name, academic_year, term)`, `exm_slots(id, college_id, series_id, class_id, subject_id, on_date, starts, ends, room)`. Routes: series CRUD (admin), slot create/delete (admin; warn-only clash vs timetable read model — response carries `clash?: string`), class-schedule (staff scope), my-exam-schedule (student self), hall-ticket PDF (reporting kind `hall-ticket`, per student, scope-checked).

**Screens:**
- `/manage/exams` (admin): series list + create; slot editor per series+class — rows (date, time, subject, room) with inline add; clash warning renders as warn Badge on the row ("Room 12 busy: BSc-1 Physics"), not a block.
- **Portal — Exams card**: next exam highlighted (date, paper, room), full schedule table below, "Download hall ticket". Empty: "No exams scheduled."

**Tasks:**
- [ ] **E1 — Contract**. Commit.
- [ ] **E2 — Frontend**: api block, `/manage/exams`, portal card; RTL: clash-warn render, empty state. Commit.
- [ ] **E3 — Backend**: schema/migration/repo/handlers + clash-warn unit test; hall-ticket PDF kind. Commit.
- [ ] **E4 — Integration**: wiring, seed one series with 4 slots incl. one deliberate clash-warning, drive admin + student. Merge.

---

## Phase 5 — M7 Staff leave (approvals only)

**Brief:** the **leave register**. Two jobs: teacher — *"apply and know where it stands"*; HOD/principal — *"approve or reject with a reason."* Messages/complaints cut.

**Contract:** `lvs_requests(id, college_id, department_id, teacher_id, from_on, to_on, kind 'casual'|'sick'|'duty', reason, status 'pending'|'approved'|'rejected', decided_by, decided_at, decision_note)`. Routes: apply (teacher self-link), my-leaves (self), pending-for-me (HOD dept scope / principal college), decide (HOD/principal, audited).

**Screens:**
- `/manage/leave` (teacher): apply Modal (from/to native dates, kind select, reason) + my-requests `DataTable` with status Badges (pending=warn, approved=good, rejected=accent + decision note on expand).
- HOD/principal: same route shows **Approvals** section on top — pending `DataTable` (teacher, dates, kind, reason) with Approve/Reject (reject requires note); dashboard card "3 leave requests waiting."

**Tasks:**
- [ ] **L1 — Contract**. Commit.
- [ ] **L2 — Frontend**: api block, `/manage/leave` (role-adaptive sections), dashboard card; RTL: teacher vs HOD render, reject-note required. Commit.
- [ ] **L3 — Backend**: schema/migration/repo/handlers; denial tests (teacher deciding own request 403, HOD outside dept 403). Commit.
- [ ] **L4 — Integration**: wiring, seed pending+decided requests, drive teacher-apply → HOD-approve. Merge.

---

## Phase 5.5 — Class Workspace + dashboard "Today & Pending" (frontend-only, from VEFS)

**Brief:** the teacher's **digital classroom** — open "BSc-2 · A" and everything about that class is there. No new backend: every tab is a re-scoped render of data the modules already serve. Runs after M6 so the workspace can show exams too.

**Screens:**
- **`/manage/class/[sectionId]`** (teacher/class_teacher/admin, scope-checked by existing reads): header (class · section · student count · attendance % chip) + Tabs — **Overview** (today's periods for this section, attendance status, assignments due, next exam) · **Attendance** (existing attendance grid pre-filtered, no pickers) · **Students** (roster with attendance % and marks average, links to profiles) · **Coursework** (that class's assignments + materials, reusing the manage-coursework tables) · **Marks** (assessments list → existing entry grid) · **Exams** (M6 class schedule). Every tab is the existing page's component with the class/section pinned — extract shared components where the pages allow, don't rebuild.
- **Dashboard "Pending tasks" card** (teacher): attendance not yet submitted for today's periods, submissions awaiting evaluation (count from coursework), leave requests waiting (HOD). Each line links straight into the workspace. Empty state: "All caught up."
- **Portal attendance guidance**: on the attendance section, when below the threshold, one computed line — "Attend the next 11 classes to reach 75%." Pure function `classesNeeded(attended, held, thresholdPct)` with unit tests; shown only when short.

**Tasks:**
- [ ] **W1 — Shared component extraction**: lift the attendance grid, assignments table, and marks entry grid into reusable components consumed by both the original pages and the workspace (no behavior change; RTL stays green). Commit.
- [ ] **W2 — Class Workspace page**: tabs + overview composition; class-teacher lands here from dashboard tile. RTL: tab render per role, scope denial state. Commit.
- [ ] **W3 — Pending tasks card + portal shortage line** (+ `classesNeeded` tests). Live drive as teacher: dashboard → pending task → workspace → take attendance without touching a picker. Commit.
- [ ] **W4 — Class-teacher scoped student edit** (owner ruling 2026-07-13): the record splits in two. **Contact fields** (phone, address, guardian name/phone) become editable by the class teacher **of that student's section** (and admin) — new people route `people.student-contact-update` (audited; scope check = class-teacher grant on the section, fail closed) + "Edit contact" modal on the workspace Students tab. **Identity/enrollment fields** (name, admission no, DOB, class/section) stay admin-only because fees receipts, marksheets, and hall tickets hang off them. Unit tests: class teacher of section A editing section B student → 403; contact edit audited. Merge.

---

## Phase 6 — M11 Licensing (the W2 spec, unchanged in substance)

**Brief:** the business-model gate. License file = ed25519-signed JSON claims (collegeIds, plan, features, expiry, seat caps); public key in the binary; no phone-home. Pipeline: `RouteSpec.feature?: string` checked in `defineRoute` → 402 problem+json when absent. UI hides unlicensed nav.

**Screens:** `/manage/license` (admin): status card (plan name, expiry with countdown copy "Renews in 41 days", seats used/cap as mono fraction, feature list as Badge chips — licensed good, unlicensed neutral "not in plan"); upload-license field (file → validate → toast "License updated — Plus plan until 2027-06-30", invalid → "That file isn't a valid license. Check you received it from your vendor."). Nav consumes `/api/v1/system/license` to hide gated groups.

**Tasks:**
- [ ] **K1 — Contract + platform gate**: `RouteSpec.feature`, defineRoute check + 402 problem type, `lic_licenses` schema, license read/upload routes; feature tags added to existing RouteSpecs (coursework, fees, results, exams as plan-gated). Commit.
- [ ] **K2 — Frontend**: `/manage/license` + nav gating; RTL: unlicensed nav hidden, 402 state page. Commit.
- [ ] **K3 — Backend**: verify/sign (`scripts/license-tool.ts` keygen/mint), handlers, unit tests: expired, wrong college, tampered signature, feature miss → 402. Commit.
- [ ] **K4 — Integration**: wiring, seed dev license (all features), drive: strip a feature → nav entry vanishes + direct URL answers 402 page. Merge.

---

## Phase 7 — M12 Hardening (mostly non-UI)

- [ ] **H1 — Cross-tenant regression suite**: table-driven integration test — college-B caller × every college-A resource ⇒ 403/404 for **every route in the registry** (route table is introspectable; the test iterates it, so future modules are covered for free). Commit.
- [ ] **H2 — Seat enforcement**: license seat caps consulted on people/identity create paths; unit tests at cap / over cap. Commit.
- [ ] **H3 — Backups + prod posture**: `scripts/backup.ts` (pg_dump + MinIO mirror) + restore runbook section; `loadConfig` refuses default secrets / insecure cookies when `NODE_ENV=production`. Commit.
- [ ] **H4 — Audit viewer**: `/manage/audit` (admin, read-only): filter bar (actor, action, resource, date range) + `DataTable`, mono timestamps; empty "No audit entries match." RTL + drive. Merge.

---

## Phase 8 — M13 Reports catalog + super-admin home

**Brief:** one place to ask for paper. The reporting engine exists; this phase is catalog UI + assembling the admin home.

- [ ] **C1 — Report kinds audit**: wire kinds shipped by now into one catalog config: attendance register (exists), fee-collection, fee-dues, grade-card, class-results, hall-ticket. Any missing kind = small reporting-module addition, same pattern as existing kinds. Commit.
- [ ] **C2 — Frontend**: `/manage/reports` gains **Request panel** — kind select → scope pickers appropriate to kind → format → submit → lands in the existing reports inbox (reuse ReportButton/inbox flow); RTL. Commit.
- [ ] **C3 — Super-admin home**: `/dashboard` for admin assembles existing endpoints — institution KPI tiles, license status card, audit tail (last 10), backup status line, quick links. Pure composition, no new backend. Drive. Merge.

---

## Phase 9 — Program integration & architecture close-out

- [ ] **P1 — Full-journey E2E** (Playwright, one script, seeded stack): admin sets up year (org → structures → generate invoices → timetable → exam series) → teacher takes attendance + enters marks + posts assignment → student submits + checks dues + downloads hall ticket → accountant collects (receipt no. asserted gap-free across 3 payments) → principal publishes results + reads noticeboard → student downloads grade card. Screenshots reviewed both themes.
- [ ] **P2 — Performance pass**: indexes audit against `docs/performance.md` budgets (`fee_invoices(college_id, academic_year, status)`, `ntc_notices(college_id, publish_at)`, `lvs_requests(college_id, status)`, `exm_slots(series_id)`); explain-analyze the defaulters + collections + audit-viewer queries on seeded volume (5k students).
- [ ] **P3 — Accessibility sweep**: keyboard walk of every new screen, focus order in modals, `aria-label` on every SVG/figure, AA contrast spot-check both themes.
- [ ] **P4 — Docs**: `docs/frontend-design.md` gains per-module design sections (fees counterfoil, marksheet, noticeboard); `architecture-and-workflows.md` §5 table updated; OpenAPI export committed; ADRs for licensing crypto + any new report kinds.

---

## Merge train & sequencing

Sequential by default (one branch in flight, controller = this session):

**M4 Fees → M3 Notices → M5 Results → M6 Exams → M7 Leave → Class Workspace (5.5) → M11 Licensing → M12 Hardening → M13 Catalog → P-phase.**

Rationale: M4 is half-built (finish first, momentum + revenue feature); M3 is small and de-risks the shared-card pattern M5/M6 reuse on portal/dashboard; M5 before M6 because hall-ticket/marksheet PDFs share the reporting-kind pattern R4 establishes; M11 late so `feature` tags decorate routes that already exist; M12/M13 close the sellable story.

If parallel lanes are wanted later, the shared-file law (Global Constraint 9) and worktree isolation from the v1 master plan apply unchanged — M3 and M5 are the natural second lane after M4 merges.

## Deferred backlog (post-v1, same recipe)

M8 Library (fines post into the fees ledger — one money system) · M9 Hostel/Transport (charges post into fees) · M10 Placement (eligibility from M5 GPA read model) · M14 Parents (second identity link, read-only portal) · online payment gateway (portal "Pay now", needs `sys_settings` + provider) · notices read-receipts · attendance-correction approval chain (teacher requests → HOD approves; today same-day edits suffice) · richer attendance statuses (late/medical/on-duty) · student documents/certificates downloads (bonafide, ID card) · everything in the VEFS reject list above (QR/RFID/face, rubrics, question banks, moderation, AI features, …).

## Risks

- **GPA correctness** — golden-number tests in R1/R3 are the anchor; no publish without them green.
- **Receipt-number gaps under concurrency** — repo already serializes via counter row; P1 asserts gap-free explicitly.
- **Role ripple** (accountant already landed; no new roles in scope) — librarian/placement deferral avoids two role recipes this round.
- **Shared-file drift** if lanes go parallel — block-append law, controller merges.
- **Session budget** — every phase commits compiling checkpoints; ledger lets any session resume.
