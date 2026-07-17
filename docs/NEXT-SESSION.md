# Vidya ERP — Next-Session Handoff

Paste this whole file into a fresh Claude Code session to continue.

---

## You are continuing Project Vidya
An on-prem college ERP: **Next.js App Router** (`apps/web`) + a modular monolith of
`@vidya/module-*` packages, **TS strict, pnpm, Postgres/Redis/MinIO via Docker**.
Repo is on GitHub: **github.com/tejas104/vidya-erp** (remote `origin`, branch `main`;
`git push` works). Everything is committed.

### Working agreements (hold these)
- **Ponytail**: smallest change that fully works; reuse before build; **no new runtime deps** (ADR-0009).
- **Real endpoints only** — never hardcode demo numbers into UI; if an endpoint is missing, show an honest empty/withheld state and say so.
- **Five states** per screen: loading / empty / error / denied(403) / withheld.
- **Both themes** from tokens; `:focus-visible`; respect `prefers-reduced-motion`.
- The **ScopeChecker is human-owned** (`packages/modules/identity/src/core/scope-checker.ts` + its conformance matrix) — propose + update the matrix, flag for the owner, don't silently author auth.
- **Live-verify**: run integration tests against the real DB + reseed; don't trust the ledger.
- **No screenshot tooling here** — you CANNOT see the UI. Ask the owner to eyeball visual work; don't claim visuals are confirmed.
- Commit/push only what's asked; end commit messages with the Co-Authored-By trailer.

### Run + verify (bash env for tests/seed)
```
export DATABASE_URL="postgres://vidya:local-dev-only-pg@localhost:5432/vidya" \
  REDIS_URL="redis://localhost:6379" S3_ENDPOINT="http://localhost:9000" \
  S3_ACCESS_KEY_ID="local-dev-only-minio" S3_SECRET_ACCESS_KEY="local-dev-only-minio-secret" S3_BUCKET="vidya"
```
- Unit/UI: `npx vitest run --project unit --project ui`  (currently **685 passing**)
- Integration (real DB): `INTEGRATION_RESET_DB=true npx vitest run --project integration --no-file-parallelism <file-substr>`
- Reseed clean: drop `public` schema → `npx tsx scripts/migrate.ts up` → `VIDYA_ALLOW_DEMO_SEED=true npx tsx scripts/seed-demo.ts`
- After any route change: `pnpm openapi:generate`. Build check: `pnpm --filter @vidya/web build`.
- Run app (Windows): load `.env` then `pnpm dev`; worker in another terminal (`pnpm dev:worker`). SETUP.md has details + demo logins.

### ⚠️ Apply pending migrations first
The live dev DB may be behind. Run `npx tsx scripts/migrate.ts up` (applies people `0003_student_profile`, `0004_student_documents`, notices `0001_calendar`, academics `0001_attendance_subject`) — or reseed. **Reports run in the WORKER** — `pnpm dev:worker` must be running or reports stay "pending".

## What's DONE (this arc)
M1–M7 + these, all typecheck + tests + build + reseed green (but **not visually verified**):
- **2.1** subject-teacher attendance · **2.2** flashcards (`section-roster-attendance`) · **2.3** backlog/ATKT lifecycle + `/manage/backlogs`
- **App-wide rebrand** to a cool navy/brand-blue system (globals.css `:root`), Inter+Plex, dark rail, gradients structural-only
- **Class Workspace** `/manage/classes` (RingStat, StudentCard, TodayTimeline, StudentDrawer) · **mobile attendance** (flashcard grid, P/A/E segmented, sticky save)
- **Academic Calendar** `/manage/calendar` (notices seam) · seed broadened to **3 depts / 6 classes / ~66 students**
- Attendance "late" removed; **class teacher also teaches a subject** (seed); **principal read-only fees** + **printable receipt**
- **2.5 profile depth** (phone/guardian/DOB) · **2.4 class-teacher scoped sub-admin** (add/edit/status own-section, 403 else, live-verified) · **2.5 documents** (photo/ID/marksheet/TC upload to MinIO, drawer UI, photo=avatar)
- **Reports FIX**: added a Generate panel (6 kinds) — the page only listed before

### Session 2026-07-17 (committed; NOT visually verified — no screenshot tooling)
- **In-app notifications** — a notice **bell** in the top bar (`NotificationBell`) over the existing `notices.visible` feed; unread badge via a `vidya-notifs-seen` localStorage timestamp (per-device, no backend/table). `bell` icon added.
- **Login redesign** — split-screen (gradient hero + card) with a **Student/Staff role chooser** (tailors copy + dev demo-prefill; same login endpoint for all) and a **dark-theme fix** (inputs used `--paper` and vanished; now a surfaced card + sunken inputs). Dev lockout loosened in local `.env`: `LOGIN_MAX_ATTEMPTS=100` (schema caps at 100 — do NOT set higher; `.env.example` stays 5).
- **Admin = non-teaching supervisor** — removed admin from the Teaching nav group (My Classes/Attendance/Marks/Coursework/Leave). The ScopeChecker ALREADY denied admin academic writes ([scope-checker.ts:88-105]); the nav was showing dead-end links. No ScopeChecker change.
- **Teacher dashboard redesign** — `/dashboard` is now **role-adaptive**: teaching-only staff get a "next-class command card" view (next class + one-tap attendance, rest-of-today, needs-attention, stat strip, RiskDonut pie, notices); hod/principal/admin keep the analytics dashboard. Approved via an Artifact mock (Figma unavailable — owner on a view-only seat).
- **Admin-set-password (identity)** — `POST /users/{id}/password` (admin) sets a user's password directly → account active, sessions invalidated. Owner-ratified **deviation from ADR-0011** (which was token-only); ADR updated. Force-change-on-next-login deferred (needs a login-flow change — the current login blocks `must_reset`). Students already appear in `/manage/users` and are resettable. UI: "Set password" + "Reset (token)" per user row.
- **Accountant read-only Student directory** — `/manage/directory` (nav for accountant): section roster + document view. Zero backend change — the read routes are already `ANY_AUTHENTICATED` and the ScopeChecker grants accountant college-wide read.
- **⚠️ Owner to ratify:** the ADR-0011 deviation is recorded; no ScopeChecker/conformance-matrix change was needed this session.

## Remaining — the owner's wishlist (prioritize with them)
**Green/quick (safe blind):** shadows on cards; timestamps in more lists; seed 3+ sections per class; login **student vs staff** hint.
**Features (1 per turn):** teacher profiles; deeper student management; more teacher options; wire **fees-per-student** into the workspace ring + drawer (currently "not wired"); subject-teachers aside; corrections queue. (Notifications DONE 2026-07-17.)
**Needs owner's eyes / decisions:** the OTHER dashboards (hod/principal/admin analytics — the charts/"maps" look bad) + darker theme + spacing polish — do in a `pnpm dev` session (teacher dashboard already redesigned); **force-change-password-on-next-login** (Option B — a login-choreography change, owner sign-off needed); **SaaS licensing w/ cancellation** (Step 4 — license keys/expiry/enforcement, sizable); "admin/features not showing" is almost certainly **role-gating** — ask which feature + which role before treating as a bug.
**Also pending:** grouped rail contextual "Class teacher · [section]" group; syllabus; library; Step 3 nav-correctness (distinct 403 state, icon reuse) + role dashboard density; Step 4 hardening (backups, TLS/headers, rate-limit, DPDP).

## Gotchas
- Memory: `~/.claude/projects/d--ATLAS/memory/` — read `vidya-4step-plan.md` first.
- `docs/design/teacher-workspace-reference.html` is referenced but NOT on disk (owner pasted `vidya-modern.html`).
- Integration tests share state — use `INTEGRATION_RESET_DB=true`; reseed needs a schema drop when a prior admin exists.
