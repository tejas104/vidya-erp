# Assignment #10 remainder + #10.5 Security Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Base:** main `f36956a` (Assignment #10 Parts 1–2 merged).
**Branch:** `feat/a10-remainder-a105-security`

## Why

Assignment #10 shipped Parts 1–2 (design system, nav/IA). **Parts 3, 4, 5 were never
started** — verified at `f36956a`: no `manifest.json`, no service worker, no
`beforeinstallprompt`, no teacher "Now" screen, no ANALYTICS nav group, and none of
the 4 required new e2e journeys. #10.5 lists "#10 complete" as its precondition, so
both land together on one branch.

## Two tracks, disjoint file trees — safe to run in parallel

| | Track A (#10 remainder) | Track B (#10.5 security) |
|---|---|---|
| Owns | `apps/web/app/**`, `apps/web/public/**`, `apps/web/src/ui/**` | `packages/platform/**`, `packages/modules/identity/**`, `Caddyfile`, `docker-compose.prod.yml` |
| Backend changes | **FORBIDDEN** (#10 constraint) | **REQUIRED** (#10.5 is backend work) |
| e2e spec file | `tests/e2e/fast-path.spec.ts` (new) | `tests/e2e/security.spec.ts` (new) |

Separate new e2e files so the tracks never collide. **Neither track edits
`tests/e2e/role-journeys.spec.ts`** — the existing 18 are the regression net and must
pass unchanged.

**Within a track, tasks run strictly one at a time** (shared files). Across tracks,
one agent each may run concurrently.

## Global Constraints

- **Track A is presentation-only.** ZERO changes under any `**/handlers/**`,
  `**/schema/**`, `**/migrations/**`, `packages/platform/src/auth/**`. If a UI
  improvement seems to need one → **STOP and report as a finding.**
- **Track B hard boundary:** `PasswordHasher`, `SessionManager`, `ScopeChecker`
  **implementations** are human-owned — consume interfaces only
  (`packages/modules/identity/src/core/contracts.ts`). If lockout or session
  semantics require a change *inside* those, **STOP** and report the exact interface
  gap.
- Both style gates (`pnpm check:styles`) and both typechecks stay green.
- Existing e2e 18/18 stays green at every task boundary.
- Commit by explicit path, **never `git add -A`** — owner WIP is uncommitted
  (`apps/web/app/(app)/manage/system/`, `backups/`, `certs/`, `scripts/*.sh`,
  `docs/deployment-checklist.md`, `docs/runbook-backup-restore.md`, `.dockerignore`,
  `.claude/`). `Caddyfile` and `docker-compose.prod.yml` are also untracked but ARE
  Track B's to commit (see B3).

## Pre-flight findings (already established — do not re-derive)

- `PasswordHasher.dummyHash` **exists** (`contracts.ts:29`) and is **already used** by
  the login flow (`identity/src/service/auth-service.ts:93`). Part 2's timing
  requirement is largely satisfied; the task is to **verify and evidence it**, not
  build it. No STOP.
- `SessionManager` has no lockout concepts (`issue`/`resolve`/`invalidate`/
  `invalidateAllForUser`). Lockout is per-credential, not per-session → lives in a
  new Redis-backed store outside it. No STOP.
- `defineRoute` (`packages/platform/src/http/define-route.ts:110`) is the single
  request-pipeline chokepoint → the global limiter belongs there, not per-module.
- `AuditLogger.record(AuditEvent)` (`packages/platform/src/audit/types.ts`) is the
  audit seam. Note: the http pipeline **fails the request if the audit write fails** —
  consider that when auditing auth failures.
- Redis client: `packages/platform/src/redis/client.ts`; identity already receives one
  (`IdentityCoreOptions.redis`).
- Session cookie posture already: `HttpOnly`, `SameSite=Strict`, `Secure` (configurable)
  — `identity/src/service/cookies.ts` + ADR-0011. Part 3 asks to **report posture with
  evidence before changing anything**; expect "already correct, no change".
- **No security headers exist anywhere yet** (grep for CSP/X-Frame-Options/HSTS: empty).

---

# TRACK A — Assignment #10 remainder

### Task A1: nav ANALYTICS group + search gap
**Files:** `apps/web/src/ui/navConfig.ts` (+ its test), `apps/web/src/ui/search/*`.
- [ ] Spec's groups are PEOPLE / ACADEMICS / FEES / COMMUNICATION / REPORTS /
      **ANALYTICS** / ADMINISTRATION. `ANALYTICS` is currently absent — add it and move
      the analytics-dashboard entry into it. Keep `TOP` (ungrouped) for Dashboard/portal.
- [ ] Spec wants global search to jump to **staff**. S2a dropped this: there is no
      teachers-list endpoint, and #10 forbids adding one. **Do not add a backend
      endpoint.** Determine whether an existing scoped endpoint can supply staff, and
      if not, **report it as a STOP finding** with the exact gap. Do not fake it.
- [ ] Commit `feat(nav): ANALYTICS group`.

### Task A2: PWA (Part 3)
**Files:** `apps/web/public/manifest.json`, icons, `apps/web/public/sw.js`,
`apps/web/app/layout.tsx` (link/meta + registration), a small A2HS component.
- [ ] `manifest.json`: name, short_name, icons (192/512 + maskable), `display:
      "standalone"`, `theme_color`, `background_color`, `start_url`.
- [ ] Service worker caching **static assets ONLY**. **Never cache API responses** —
      no offline data, no sync. A `fetch` handler must bypass anything under `/api/`.
      State this in a comment; it is a spec requirement, not an optimisation.
- [ ] "Add to Home Screen" prompt: unobtrusive, **teacher/student roles on mobile
      only, shown once** (persist the dismissal).
- [ ] Session TTL: use existing `SessionManager` config **as-is**. If it cannot express
      a mobile-appropriate value, **report — do not modify SessionManager.**
- [ ] Commit `feat(pwa): manifest, static-asset service worker, install prompt`.

### Task A3: Teacher fast-path — Now screen (Part 4)
**Files:** new route under `apps/web/app/(app)/`, ui-system primitives only.
- [ ] Teacher mobile home = **"Now"**: current/next period from the timetable with ONE
      primary button "Mark attendance", then today's remaining periods. **Not a
      dashboard.**
- [ ] Reuse existing timetable/today endpoints (`api.ttMyToday` or equivalent) —
      no new endpoints.
- [ ] Fully usable at **360px**, thumb-reach primary action.
- [ ] Commit `feat(teacher): Now screen fast-path`.

### Task A4: Attendance thumb-grid + marks fast-entry (Part 4)
**Files:** `apps/web/app/(app)/manage/attendance/page.tsx`,
`apps/web/app/(app)/manage/marks/page.tsx`.
- [ ] Attendance: all students **PRESENT by default**, roll-number grid, thumb-sized
      cells, tap toggles absent — **visually unmistakable (filled vs outline + icon,
      never colour alone)**, running absentee count, single Save. Target: 60 students
      in under 30s. Late/excused behind a secondary control, not cluttering the primary
      flow.
- [ ] Marks: numeric-keypad-first (`inputMode="numeric"`), **auto-advance** on entry,
      running progress (37/60), single save, per-row inline validation. Arrow-key nav
      on desktop.
- [ ] Identical for subject-teacher and whole-section contexts — **scope rules
      unchanged**.
- [ ] **Keep existing e2e selectors stable** (J3 attendance, J5 marks touch these).
- [ ] Commit per screen.

### Task A5: e2e journeys + evidence (Part 5)
**Files:** `tests/e2e/fast-path.spec.ts` (new), `tests/shots/a10.shots.ts`.
- [ ] (a) teacher fast-path at **360px** → Now screen → mark 3 absentees → save →
      assert persisted via the student portal view.
- [ ] (b) marks fast-entry journey. (c) global search → find student by roll number →
      open SlideOver. (d) PWA manifest served and valid.
- [ ] All pre-existing journeys pass **unchanged**.
- [ ] Screenshots at 1280 **and** 360 for the new screens; Lighthouse PWA
      installability report.
- [ ] Commit `test(e2e): assignment #10 fast-path journeys` + evidence commit.

---

# TRACK B — Assignment #10.5 security hardening

### Task B1: Redis rate limiting (Part 1)
**Files:** new `packages/platform/src/ratelimit/*`, wired into
`packages/platform/src/http/define-route.ts`; env config in
`packages/platform/src/config/env.ts`.
- [ ] **One platform middleware. No per-module hand-rolling.** Counters in Redis with
      TTL so limits are shared across instances.
- [ ] Login: per-IP (10/min, then exponential backoff) **AND** per-username (5/min
      regardless of IP — stops distributed guessing of one account).
- [ ] Password-set/reset: stricter, 3/min.
- [ ] Global per-session ceiling (~100 req/min) — **generous enough that no legitimate
      flow ever trips it.** Measure the e2e suite's natural request rates and **state
      the measured margins** in the report. CSV import preview and marks entry are the
      burst-heavy flows to check.
- [ ] 429 + `Retry-After`; UI shows a human message.
- [ ] Defaults documented in env config.
- [ ] Commit `feat(platform): redis-backed rate limiting`.

### Task B2: Lockout, audit, timing (Part 2)
**Files:** `packages/modules/identity/src/service/*` (NOT `core/`), user-management
unlock action.
- [ ] Progressive lockout: 15-min lock after 10 consecutive failures, surfaced to the
      user, **auto-expiring**. Admin can unlock early via a user-management action,
      **audited**.
- [ ] All auth failures / lockouts / unlocks → append-only audit log **with IP and
      user agent**. Note the pipeline fails the request if an audit write fails —
      handle deliberately and explain the choice.
- [ ] Timing: verify unknown-username and wrong-password are indistinguishable.
      `dummyHash` is already consumed at `auth-service.ts:93` — **evidence this with a
      test**, don't rebuild it.
- [ ] **Do not modify `PasswordHasher`/`SessionManager`/`ScopeChecker` implementations.**
- [ ] Commit `feat(identity): progressive lockout + auth audit trail`.

### Task B3: HTTP hardening (Part 3)
**Files:** `Caddyfile` (currently untracked — commit it), `docker-compose.prod.yml`,
Next config / platform response headers.
- [ ] **First: report the current CSRF posture with evidence, before changing
      anything.** Expect: `HttpOnly` + `SameSite=Strict` + `Secure` already set
      (`identity/src/service/cookies.ts`, ADR-0011). Confirm state-changing routes'
      protection and say plainly what is and isn't covered.
- [ ] Headers: **CSP report-only first, then enforce — document the policy**;
      `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
      **HSTS in the prod overlay only** (never on localhost/self-signed).
- [ ] Request body size limits **per route class** (uploads vs JSON).
- [ ] Verify absence of: directory listing, stack traces in prod error responses,
      verbose server headers. Show the evidence.
- [ ] Commit `feat(security): HTTP hardening headers and body limits`.

### Task B4: Security evidence + SECURITY.md (Part 4)
**Files:** `tests/e2e/security.spec.ts` (new), `SECURITY.md`.
- [ ] e2e: (a) 11 rapid failed logins → 429/lockout observed → **correct audit rows
      exist**; (b) locked account rejects the *correct* password until expiry/unlock;
      (c) headers present on a sampled page **and** API response; (d) oversized body
      rejected.
- [ ] `SECURITY.md`: what's enforced, config knobs, and the **deferred list** (TOTP 2FA
      for admins, per-role session policies, IP allowlisting for admin routes) so sales
      can answer "what about security?" honestly.
- [ ] Evidence: e2e output, `curl -I` header scan, **Redis key TTL demonstration**,
      `git diff --stat` proving `core/` security files untouched, and an **explicit
      list of any STOP conditions hit**.
- [ ] Commit `docs(security): SECURITY.md + hardening evidence`.

---

## Verification (both tracks, at the end)

- Full e2e green — existing 18 **unchanged** + 4 #10 journeys + 4 #10.5 guards.
- Screenshots at 1280 and 360; Lighthouse PWA installability report.
- Grep proof: no legacy style-module imports; no hex outside tokens (`check:styles`).
- `git diff --stat` proving **zero** Track-A changes under `handlers/`/`schema/`/
  `migrations/`/`platform auth/`, and **zero** changes to identity `core/`
  implementations from Track B.
- Explicit list of every STOP condition hit, with the exact interface gap.
