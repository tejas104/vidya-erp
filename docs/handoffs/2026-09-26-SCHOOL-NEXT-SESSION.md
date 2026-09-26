# Vidya school ERP: next-session handoff (after N6 first slice)

Copy the prompt below into a new session. The repository state and user
instructions take precedence if anything here has changed.

```text
Continue the Vidya school ERP in D:\ATLAS\.worktrees\claude-school-product on
branch codex/claude-school-product. First verify Git status, HEAD, remotes,
worktrees and any AGENTS.md. origin/main was
bf56a3853cb48e5102525c7f1bc8999beab51d9c; the branch carries the local N5
export commit 72d980e and the N6 commit on top of it. Do not push, merge,
deploy or publish until the owner explicitly says so. Preserve other worktrees
and the Docker demo data (Compose project vidya-school-demo, 40 fictional
pupils; read docs/demo/SCHOOL-LOCAL-DEMO.md before touching it).

The latest slice is N6's first bounded workflow: an administrator page
"Promotion and exits" (/manage/progression, school edition) closes one
section's academic year. Each pupil is promoted, detained (reason), transferred
out (reason), graduated, or left undecided. POST /api/v1/people/progression/
preview and /apply share one validation; apply is one transaction that closes
the source enrollment row with its outcome (people migration 0010), creates the
next-year row for promotion/detention, sets the student status, and writes a
per-pupil people.student-progressed event plus a people.progression-applied
batch event in the same transaction (ADR-0026). A changed roll makes apply 409/
422 and nothing is written. Exits set guardian validUntil to the day after the
leaving date and historicalAccessUntil 90 days later, revoke pending
invitation codes and refuse new invitations (ADR-0027 Decision 9). During the
window a guardian gets only attendance entries recorded before the exit and
report cards whose current release predates it; fees, notices, marks and
timetable are refused. In the school edition a bare transferred/alumni status
PATCH is refused (409) and hidden in the UI.

Read docs/strategy/CLAUDE-DELIVERY-ROADMAP.md (N6 row) and
content/help/school/progression.md. N6 is not complete. Next bounded steps, in
order: per-pupil reversal of an applied outcome (append-only, audited, only
while the next year has no dependent records); the per-school setting for the
90-day window; a single-pupil mid-year exit entry point from the student page;
then N7 transfer and bonafide certificates, which can now read the recorded
exit (enrollment outcome, reason, ends_on). N5 notification/escalation policy,
real-school pilot review, broader UI work, licensing and hosting gates remain
open. Report the exact local commit and test evidence at the end.
```

## Evidence recorded for the N6 commit

- `pnpm typecheck`, `pnpm lint` (including style checks), `pnpm openapi:check`.
- Unit: people handler tests (preview, apply rows, problems, scope, edition
  guard), guardian wind-down tests, portal attendance cut-off.
- Integration (real Postgres): `tests/integration/progression.int.test.ts`
  (batch outcome, kept rows, guardian windows, revoked codes, in-transaction
  audit, rollback on injected audit failure) and the report-card wind-down case
  in `tests/integration/school-report-cards.int.test.ts`. The migration rollback
  walk now registers every migration, including seven that had no expectation.
- Browser: `tests/e2e/school/progression.spec.ts` in `pnpm test:e2e:school`.

These checks do not prove a real-school pilot or production readiness.
