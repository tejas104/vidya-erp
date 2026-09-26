# Vidya school ERP: next-session handoff

Copy the prompt below into a new Codex session. The repository state and user
instructions take precedence if anything here has changed.

```text
Continue development of the Vidya school ERP in D:\ATLAS. First inspect Git
status, HEAD, branch, remotes, worktrees, and any AGENTS.md. The active school
worktree is D:\ATLAS\.worktrees\claude-school-product on branch
codex/claude-school-product. Work in that worktree, preserve unrelated changes,
and verify its current HEAD before editing. GitHub main/origin/main was
bf56a3853cb48e5102525c7f1bc8999beab51d9c before the local N5 export
commit. The owner explicitly said: do not push changes until I say it. Do not
push, merge, deploy, or publish during this session without a new explicit
instruction. Do not reset/clean other worktrees or delete demo volumes.

Use GPT-6 models only. Use Astra only for frontend/UI tasks or a full final
review, at light effort; use GPT-6 Sol at light through extra-high effort for
other work. Do not use GPT-5.6 models. No subagents unless the current user or
applicable instructions explicitly request delegation. Keep original UI and
code; use Alma, EdPlus and Vidyalaya as feature/UX references, not as assets to
copy. The priority is a complete, secure school-first ERP demo; licensing and
public hosting follow after the school workflow is ready.

The latest local slice added queued, scoped PDF/Excel/CSV exports to the school
Attendance review page. It shares the live review calculation, preserves
unsubmitted registers and missing pupil entries, withholds percentages where
enrollment dates are unverified, and rechecks scope before download. Reporting
migration 0007 adds the new report kind. Verify the current commit and clean
status. It was checked with pnpm typecheck, pnpm lint, pnpm openapi:check,
focused reporting/UI tests, 8/8 school browser tests, and a real Docker demo
download of all three formats. The demo is an isolated Docker Compose project
named vidya-school-demo on http://localhost:3125/login with 40 fictional
pupils. Read docs/demo/SCHOOL-LOCAL-DEMO.md before running it or changing its
data. The amber no-licence notice is expected. These checks do not prove a
real-school pilot or production readiness.

Read docs/strategy/CLAUDE-DELIVERY-ROADMAP.md and
docs/strategy/COMPETITIVE-PARITY-MATRIX.md. Continue the next bounded school
workflow, N6 promotion/detention/transfer, after inspecting the people module,
existing enrollment history, authorization, and ADR-0027 Decision 9. Design an
auditable preview and batch outcome, preserve historical enrollment rows, and
set historicalAccessUntil to 90 days after transfer/graduation where required.
Implement the smallest safe end-to-end slice with meaningful tests and a real
browser check. Avoid claiming N6 complete until its workflow and scope gates
are verified. N5 notification/escalation policy and a real-school pilot review
remain open, as do broader UI work, licensing, and hosting gates. Report exact
local commit and test evidence at the end. Keep changes local until the owner
explicitly asks to push.
```
