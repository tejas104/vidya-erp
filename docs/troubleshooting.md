# Troubleshooting guide

## A replica exits immediately at boot

Almost always config. The first log line is a `ConfigError` listing the
offending variable **names**. Fix the environment; values are never
printed by design.

## `/ready` returns 503

- `{"status":"draining"}` — the replica received SIGTERM and is shutting
  down; expected during deploys. If no deploy is happening, something is
  signaling your process (orchestrator OOM? restart policy?).
- `{"status":"unready","checks":[…]}` — the named check (`postgres` /
  `redis`) is failing. Details are in the replica's logs
  (`"readiness check failed"`), not in the response. A check that hangs
  >2s counts as failed (timeout).

## Every route returns 500 with "identity security core not provided"

Historical (pre-core-landing) failure mode: the fail-closed boot gate of
ADR-0012. If you ever see it again, a checkout is missing or has reverted
`packages/modules/identity/src/core/index.ts` — the core is wired on main
since #3.

## 401 on every API route

You have no (valid) session. Log in at
`POST /api/v1/identity/auth/login`; the `vidya_session` cookie must
accompany subsequent requests. Sessions also die on absolute/idle expiry
and on any role/grant/status/password change (by design). Public routes:
`/health`, `/ready`, `/metrics`, login, and reset-confirm only.

## 403 on a route you believe you may call

Three distinct gates produce 403 — check logs by requestId:
- `request rejected: forbidden` → route-level role requirement
  (e.g. management routes need the `admin` role);
- `scope check denied` → the record-level ScopeChecker (ADR-0010 matrix)
  — the caller's grants don't cover the record's org position;
- `request rejected: untrusted cross-origin` → state-changing request with
  a foreign Origin header; fix `TRUSTED_ORIGINS`.

## 429 too many attempts

Login or reset-token lockout (default 5 failures / 15 min per user+IP).
Self-expires; `Retry-After` is on the response. See the runbook before
manually clearing anything.

## Login says 403 "password reset required"

The account is in `must_reset` (new account or admin-issued reset). An
admin issues a one-time token; redeem it at password-reset/confirm.

## 500 with `requestId` on a state-changing route

Check logs for that requestId. If the message is an audit insert failure,
the request was failed **deliberately** (fail-closed audit, Constitution
rule 7) — restore Postgres/audit-table health first.

## Heartbeat rows not appearing in sys_audit_log

In order: worker process up? (`/health` on 9464) → worker `/ready` green?
→ Redis reachable from the worker? → look for `"job failed"` logs →
`vidya_jobs_total{outcome="failure"}` increasing means the processor is
throwing (likely Postgres); not increasing at all means jobs aren't
arriving (Redis/scheduler).

## `pnpm lint` fails with a Constitution message

You imported across a module boundary (deep import, platform→module, or a
route file importing anything but the composition root). Restructure the
dependency — do **not** add an eslint-disable; reviewers treat that as a
blocker (ADR-0006). If it's a legitimate new element (new top-level
folder), extend the element map in `eslint.config.mjs` in the same PR.

## `check:ownership` fails

A migration or `pgTable()` targets a table outside your module's declared
prefix, or mentions another module's prefix / `platform_migrations`.
Rename the table or move the code to the owning module — cross-module data
access goes through the owning module's service API.

## A teacher can't see their class (or sees too little)

Authority = derived grants = assignments. Check, in order: does the
teacher record have `identity_user_id` linked? Is the teacher `active`?
Does the assignment exist for the right class/subject/year
(`GET /classes/{id}/assignments`)? Then check the user's grants
(`GET /identity/users/{id}`) — the derived grant should be there with
`source: "derived"`. If assignments and grants disagree, the hourly
reconcile will repair it (or run it on demand) — and the repair audit
tells you something else deleted the grant.

## 409 "this grant is derived from a people-module teacher assignment"

Working as designed (ADR-0015): derived grants are managed by assignments.
Remove or change the assignment; the grant follows.

## 409 deleting an org unit

RESTRICT deletes: the unit still has children (or enrollments/assignments
referencing it). Empty the subtree first — there is deliberately no
cascade for org structure.

## Import stuck in "pending" / "running"

Pending: the worker isn't consuming the people queue (worker down? Redis?).
Running: check worker logs for the importId. A failed run marks the import
`failed` with the cause as row 0 in `errors`; re-POSTing the same CSV is
safe (existing rows report as per-row errors).

## Teacher gets 403 writing attendance

Working as designed: attendance is a NON-subject record — only the
class_teacher of that class writes it (the matrix's line, ADR-0017).
Subject teachers read attendance and write their own subject's marks.

## Teacher can't see or enter marks for their class

Marks are subject records. In order: does the teacher hold a
subject_teacher assignment for exactly this class AND this subject
(`GET /classes/{id}/assignments`)? Did their session predate the
assignment (grants snapshot at login — re-login)? Is the assessment under
the expected subject (`GET /assessments/{id}`)? A physics teacher will
always 403 on math marks — that is the feature.

## 422 entering a marksheet

The whole batch was rejected; the response lists per-entry reasons
(score over maxScore, student not enrolled in this class, duplicate rows).
Fix the sheet and resubmit — nothing was partially written.

## 409 recording attendance

A session already exists for that section/date/slot. Correct individual
entries via PATCH (audited) instead of re-recording; use a different
`slot` for genuinely separate sessions on the same day.

## A dashboard number shows "—" or "cohort too small"

Working as designed (ADR-0018). "Cohort too small to summarise (under 5)"
means the aggregate covers fewer than 5 students and is withheld for
everyone — open the register for the raw rows. "Outside your scope" means
constituent-closure denied it (e.g. a subject teacher asking for a class
overall that includes subjects they can't read). Neither is served as a
number, ever.

## The dashboard is empty / "Nothing to show yet"

Either the caller has no grants (permission-reflective — an unassigned user
sees nothing) or no rollup exists yet. Check the user's roles/grants in
identity; run `POST /api/v1/analytics/recompute` if the nightly rebuild
hasn't run since data first appeared.

## A teacher sees fewer subjects/figures than expected

Analytics mirror the scope matrix: a subject teacher sees their own
subject's averages and attendance, never other subjects' marks or the class
overall. The class_teacher/hod/principal see the overall. If a teacher
expects more, check their assignment (#3) — analytics can never show more
than the record-level scope allows.

## The web UI won't load past "Opening the register…"

The page fetches `/api/v1/...` with the session cookie. A blank/looping load
usually means the session expired (→ it should redirect to /login) or the
API is down (check /ready). In production, a missing `TRUSTED_ORIGINS` or a
non-Secure cookie over plain http will break the session round-trip.

## A report stays "pending" / "Preparing…" forever

Generation is a worker job. Check the worker replica is up and draining the
reporting queue, and that MinIO is reachable. A generation error lands on the
row as `status=failed` with an `error` (not an infinite retry) — inspect
`rpt_reports` and the worker logs, fix the cause, and request again. The UI
gives up polling after 30s and shows an error.

## 403 downloading a report you can see the link for

By design (ADR-0020): downloads are scope-checked, not authorized by the URL.
You get 403 if you are not the original requester, or if your scope no longer
covers the report's target (e.g. a grant was revoked after you requested it).
Request a fresh report as the account that actually has scope.

## The demo seeder refuses to run

`scripts/seed-demo.ts` requires `VIDYA_ALLOW_DEMO_SEED=true` and refuses under
`NODE_ENV=production` (it creates accounts with well-known passwords). Set both
correctly and run against a throwaway database only — see
docs/getting-started.md. If it reports "cannot sign in as the demo admin", the
database already has a different admin: use a fresh database.

## Migration runner errors

- `no paired rollback file` — write the `.down.sql`; pairing is mandatory.
- `journal drift` / `ordering drift` — the database's journal disagrees
  with the files on disk (wrong branch checked out? deleted migration?).
  Restore the files; never hand-edit `platform_migrations`.
- Hangs at start — another migrator holds the advisory lock; find it via
  `SELECT * FROM pg_locks WHERE locktype = 'advisory';`.

## Integration tests fail locally

They need real services: `pnpm compose:up` first (or export
`DATABASE_URL`/`REDIS_URL` to a dev Postgres+Redis). Never point them at a
database you care about with `INTEGRATION_RESET_DB=true` — it drops the
public schema.

## Windows notes

- Use `pnpm` scripts directly if `make` is unavailable.
- If `pnpm` is not recognized after install, run `corepack enable` once in
  an elevated shell.
