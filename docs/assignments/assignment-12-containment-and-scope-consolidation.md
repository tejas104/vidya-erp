# ASSIGNMENT #12 — Containment Proof & Scope Consolidation

**PRECONDITION:** #11 merged; full e2e green. If Docker is unavailable, STOP and report — this assignment is unverifiable without a running stack, and its whole point is verification.

**WHY THIS EXISTS AND WHY IT COMES FIRST.** The 2026-08-10 forensic audit found that four modules hand-roll record containment instead of using the shared `ScopeChecker`, that one copy carries a latent privilege escalation and another a wrong-results bug — and, decisively, that **the e2e suite structurally cannot detect any of it**. `tests/e2e/negative-scope.spec.ts:8-10` says so itself: its 9 cases are *"route-level role-gate denials: the pipeline authorizes before it ever looks at a resource."* Every case asserts a role is denied a route it may not call. **None** asserts a permitted role is denied *another record* on a route it *may* call.

So containment regressions land green today. That is a bigger hole than rate limiting, and it is why this assignment precedes the security-hardening one. **Part 1 matters more than Part 2** — without the test, you will be back here after every future assignment.

**HARD BOUNDARY:** `PasswordHasher`, `SessionManager`, `ScopeChecker` **implementations** (`packages/modules/identity/src/core/`) are human-owned. Consume interfaces only. An empty diff for that directory is a merge condition. If containment work appears to require a change inside, **STOP and report the exact interface gap** — do not work around it.

---

## PART 1 — MAKE CONTAINMENT TESTABLE (the load-bearing half)

Rewrite `tests/e2e/negative-scope.spec.ts` so it proves containment, not just role gating. Keep the existing 9 role-gate cases — they are a real regression net and must stay green — and **add a containment matrix beside them**.

For **each of the 7 roles**, attempt via **direct HTTP** (`apiSession` + `ctx.fetch`, never a hidden UI element) at least:

- **Cross-college access** — a resource in a college the caller holds no grant in → assert **403**.
- **Cross-section / cross-department access** — a resource inside the caller's own college but outside their department, class or section → assert **403**.

Both must target routes the role **is permitted to call**. A 403 from the role gate proves nothing here; the request must reach a handler that then refuses on containment. Where a role has no meaningful narrower scope (admin is college-wide by design), say so explicitly in a comment rather than inventing a case.

**The seed blocks this today, and fixing that is in scope.** `negative-scope.spec.ts:48-53` already concedes: *"A true cross-college admin denial needs a second college the single-college demo seed does not provide."* Extend `scripts/seed-demo.ts` with a **second college** carrying at least one department, class, section and student, plus a staff member scoped to it. Keep it small — this is a test fixture, not a demo expansion — and confirm the existing 27 journeys still pass against the enlarged seed.

**Verification that the test actually works.** Prove each new case fails when containment is removed: temporarily weaken one module's check, watch the specific case go red, restore it. Report which case caught which weakening. **A containment test that has never been seen to fail is not evidence.**

---

## PART 2 — CONSOLIDATE ONTO THE SHARED SCOPECHECKER

Four modules hand-roll containment. Convert them, **fixing the two defects on the way**.

### 2a. `leave` — two real defects, fix these first

**Latent privilege escalation.** `packages/modules/leave/src/handlers.ts:22-28`:
```ts
if (grant.org.departmentId === undefined) return true; // college-wide (principal/admin)
```
`OrgPath` (`packages/platform/src/auth/types.ts:24-29`) is `{ collegeId, departmentId?, classId?, sectionId? }` — the narrower fields are **independent** of `departmentId`. A grant shaped `{collegeId, classId, sectionId}` with no `departmentId` therefore reads as college-wide, letting a section-scoped holder decide **any leave request in the college**. Latent only because grant derivation currently always sets `departmentId` (`people/src/service/assignments-service.ts:47-51`) — one directly-created grant makes it live.

**Multi-college truncation.** `leave/src/handlers.ts:103` reads `principal.grants[0]?.org.collegeId` — only the **first** grant's college, so a multi-college principal silently sees one college's pending requests. Wrong results, no error.

Both disappear if containment goes through the shared checker. Add a regression test for each, at unit level, that fails against today's code.

### 2b. `exams`, `results`, `notices`

Each defines a local `inCollege(principal, collegeId)` (`exams:21`, `results:31`, `notices:34`) = "caller holds any grant in this college". Convert to the shared checker.

Preserve behaviour where it is already correct — `notices.visible` additionally filters by the caller's own grants (`notices/src/handlers.ts:121`) and that logic is sound; don't lose it. Decide deliberately whether `exams.class-schedule` (`ANY_AUTHENTICATED` + `inCollege`, so any college member reads any class's exam schedule) should narrow to the caller's classes, and **record the decision either way** — exam timetables may be legitimately college-public.

### 2c. Do not touch

`portal` (`STUDENT_ONLY`, self-scoped on principal) and `system` (preferences keyed `(userId, key)` off `principal.id`) are **legitimately exempt** — self-scoping with no request-supplied id is stronger than a grant check. `analytics` already uses the shared checker in `src/aggregation-scope.ts`. Leave all three alone.

---

## PART 3 — CARRIED FROM #10.5 PART 4

The security-evidence e2e work belongs here, now that the suite can actually express containment:

- Re-run and re-capture the #10.5 guards (rate limiting, lockout, headers, body limits) against the enlarged seed.
- Confirm the header evidence **through the Caddy overlay**, not just a bare `next start` — the prod compose path has never been booted end to end (the Docker images were reported broken with `Cannot find package 'prom-client'`; fix or report).

---

## VERIFICATION (evidence, not intent)

1. Full e2e green: 27 existing journeys **unchanged**, plus the new containment matrix.
2. **Proof each containment case fails when its check is removed** — name the case and the weakening.
3. `git diff --stat` showing `packages/modules/identity/src/core/` empty.
4. Unit + UI green with counts before/after.
5. Migration up **and** down on a scratch database — the audit could not run this.
6. Integration suite green.
7. A short statement of any STOP condition hit, with the exact interface gap.

**Do not source `.env` before `next build`** — it sets `NODE_ENV=development`, Next emits a dev-mode React build, and the `/manage/marks` prerender dies with `Cannot read properties of null (reading 'useContext')`. Build clean; source `.env` plus `NODE_ENV=production` only to start the server.

---

## OUT OF SCOPE

Username scoping for multi-college installs (admission numbers are unique per college, usernames globally unique — a collision silently skips a student). That is a product decision awaiting an owner ruling, not a bug to fix here. Also out: the `{message}` vs `problemSchema` response mismatch (84 occurrences across all 15 modules, pre-existing, deserves its own mechanical sweep).
