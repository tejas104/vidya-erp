# Vidya ERP — Next-Session Handoff Prompt

Paste this into a fresh Claude Code session to continue. It carries the state, the
working agreements, and every remaining task, prioritized.

---

## Who you are / how to work

You're continuing **Project Vidya**, an on-prem college ERP (Next.js App Router + a
modular monolith of `@vidya/module-*` packages, TS strict, pnpm, Postgres/Redis/MinIO
via Docker). Working agreements that have held all along:

- **Ponytail lazy-but-correct**: smallest change that fully works; reuse before build;
  stdlib/native before deps. **No new runtime dependencies** (ADR-0009).
- **Real endpoints only** — never hardcode demo numbers into UI. If an endpoint doesn't
  exist, render an honest empty/withheld state and say so; don't fake it.
- **Every screen keeps five states**: loading / empty / error / denied(403) / withheld.
- **Both themes** derived from tokens (light + `prefers-color-scheme` dark + `[data-theme]`).
  `:focus-visible` on interactive elements; respect `prefers-reduced-motion`.
- **The scope-checker is HUMAN-OWNED** (`packages/modules/identity/src/core/scope-checker.ts`
  + its conformance matrix). Propose changes and update the matrix, but flag them for the
  owner to accept — do not quietly author authorization.
- **Live-verify, don't trust the ledger**: run integration tests against the real DB and
  reseed; a green seed that drives real routes is the proof.
- Commit/push only when asked. **Nothing this session is committed yet** — the working
  tree holds all changes.

## Environment (see SETUP.md)

Docker stack runs Postgres/Redis/MinIO. Env for integration tests + seed (bash):
```
export DATABASE_URL="postgres://vidya:local-dev-only-pg@localhost:5432/vidya" \
  REDIS_URL="redis://localhost:6379" S3_ENDPOINT="http://localhost:9000" \
  S3_ACCESS_KEY_ID="local-dev-only-minio" S3_SECRET_ACCESS_KEY="local-dev-only-minio-secret" \
  S3_BUCKET="vidya"
```
- Unit/UI: `npx vitest run --project unit --project ui`
- Integration (real DB, applies migrations): `INTEGRATION_RESET_DB=true npx vitest run --project integration --no-file-parallelism <file-substr>`
- Reseed clean: drop `public` schema → `npx tsx scripts/migrate.ts up` → `VIDYA_ALLOW_DEMO_SEED=true npx tsx scripts/seed-demo.ts`
- Regenerate OpenAPI after any route change: `pnpm openapi:generate`
- Demo logins in SETUP.md (e.g. `demo-ct-fycs`, `demo-teacher-ds`, `demo-admin`).

## What's already done

M1–M7 shipped. This session added, all **structurally verified** (typecheck + tests +
prod build + integration/reseed) but **NOT visually verified** (no Playwright/Puppeteer here):
- **2.1 subject-teacher attendance** — attendance is now a subject record (`subject_id`,
  `''`=whole-section); subject teacher marks own period, class teacher corrects any.
- **2.2 flashcards** — `academics.section-roster-attendance` endpoint + student cards.
- **2.3 backlog/ATKT** — student lifecycle status (`active·backlog·year_back·transferred·
  dropped·alumni`, people migration `0002`); `/manage/backlogs` derived report.
- **App-wide rebrand (design direction "b")** — cool grey/navy/brand-blue system promoted
  to `:root` in `apps/web/app/globals.css` behind the existing token names; dark navy rail;
  Inter + IBM Plex Mono; gradients structural-only. Dark derived.
- **Class Workspace** (`/manage/classes`) + kit: `RingStat`, `StudentCard`, `TodayTimeline`,
  `StudentDrawer`. Scope **stubbed** (`canManage`).
- **Mobile-first attendance** (`/manage/attendance`) — 44px segmented P/A/L/E targets,
  "All present" fast path, live counts, sticky save.

---

## Remaining tasks (prioritized)

### 0. Verify visually, then commit
- No screenshots were possible here. **Eyeball** dashboard + `/manage/classes` +
  `/manage/attendance` + a couple existing pages (fees/results/students) in **light and
  dark**, desktop and **390px**. Fix any contrast/layout issues (watch the dark rail,
  and existing Register-era inline styles that may clash with the new palette).
- Then propose a commit/branch plan (the diff is large; group logically).

### 1. Wire the flagged-missing endpoints (so the workspace stops saying "not wired")
- **fees-per-student / section fees pending** — workspace fees ring + drawer Fees row.
  (Fees module has defaulters/section endpoints; add a per-student/section summary the
  class teacher may read.)
- **subject-teachers-for-section** — the workspace "Subject teachers" aside (omitted now).
- **attendance corrections queue** — the "Review corrections" CTA + "N corrections
  awaiting approval". Today corrections are immediate; design a request→approve flow if
  wanted, or drop the CTA.
- **nav counts** from real endpoints (My Classes / Coursework / Roster).
- **drawer guardian/documents** — depend on 2.5 (below).

### 2. Scope authorization (HUMAN-OWNED — author, don't stub)
- Replace the workspace `canManage` stub with a real "caller holds a `class_teacher`
  grant on THIS section" check, enforced server-side.
- This underpins 2.4.

### 3. Step 2.4 — class teacher as scoped sub-admin
Class teacher gets add / edit / change-status over **their own section only**, audited,
never hard-delete; 403 fail-closed for other sections. Needs a scope-checker change
(class_teacher writes people records within their section) + the conformance matrix +
UI (the drawer's "Change status" and add/edit, currently disabled). Admission-no · name ·
DOB stay admin-only (read-only for class teachers — the 🔒 marker is already in the drawer).

### 4. Step 2.5 — student documents
Per-student uploaded documents (photo, ID proof, prior marksheets, TC), stored in MinIO,
viewable by admin + that section's class teacher, file-type/size validated. Wire into the
drawer's Documents. Deferred: bonafide/TC generation as report kinds (same pdfkit seam as
grade-card).

### 5. Step 3 remainder — navigation & density
- **Grouped rail contextual "Class teacher · [section]" group** (Roster / Fees / Documents)
  that renders only for the class teacher of that section, with real counts.
- **Navigation correctness**: a distinct **denied (403)** state ≠ generic error; fix icon
  reuse (attendance icon serves multiple items); ensure every screen has all five states.
- **Role dashboards lead with action** (teacher: today's periods + pending; principal:
  KPIs + approvals; accountant: today's collection + defaulters), above the noticeboard.

### 6. Deferred correctness items
- **Attendance correction window** (2.1) — class-teacher correction time-limit; currently
  authority granted, window not enforced (handler-side, config).
- **on_duty / medical statuses** — deferred because analytics rollups hardcode 4 buckets
  (`present/absent/late/excused`); adding them cascades into an analytics migration +
  rollup accumulation + query-service + tests. Do that first if you add the statuses.
- **Leave principal re-route** — principal was removed from the Leave UI (nav + dashboard
  card) per owner decision, but the leave **backend** still routes HoD/college-level leave
  to the principal (`leave.pending`/`decide` say "principal: college"). Decide: re-route
  those to admin, or leave the backend as-is if no request reaches the principal.

### 7. Step 4 — the sell (deliberately last)
- Pricing/licensing model (per-student/year vs on-prem annual license); get 2–3 competitor
  quotes before quoting. Licensing enforcement contractual for first sales.
- Production hardening (audit §7): backups (`pg_dump` + MinIO mirror + a restore runbook),
  TLS + security headers (HSTS/CSP), general rate limiting (only login throttled today),
  audit failed/denied attempts (success-only today), DPDP Act posture.
- Deployment: per-college deploy runbook, known-good rollback, secrets management,
  migration rollback discipline.

---

## Gotchas
- No screenshot tooling installed — you cannot self-verify visuals; ask the owner to eyeball.
- `docs/design/teacher-workspace-reference.html` is referenced but **not on disk**; the
  design source lives in the reference the owner pasted (`vidya-modern.html`).
- Memory index: `~/.claude/projects/d--ATLAS/memory/` — read `vidya-4step-plan.md` first.
- Integration tests share state; use `INTEGRATION_RESET_DB=true` for a clean run, and the
  reseed dance (drop schema → migrate → seed) needs the schema reset when a prior
  integration/test admin already exists.
