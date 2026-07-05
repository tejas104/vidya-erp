# ADR-0016: Change control for the human-owned boundary

- **Status:** Accepted. Ratifies the two owner-authorized edits of commit
  `4011168` (the `core/index.ts` wiring and the ADR-0013 matrix extension)
  and establishes the standing rule that governs any future edit to the
  human-owned paths.
- **Date:** 2026-07-05
- **Ratifies:** ADR-0013; the ADR-0012 update of 2026-07-04.

## Context

ADR-0012 reserves `packages/modules/identity/src/core/` and its
`conformance/` suites to the security team (CODEOWNERS-enforced). For
Vidya #3 the platform owner authorized Fable to "take the best decision …
instead of doing any human changes." Under that authorization Fable made
two edits ADR-0012 reserves for the team:

1. **`core/index.ts` wiring** — mechanical assembly of the team's landed
   implementations (argon2 hasher, Redis session manager, matrix checker),
   retiring the fail-closed gate and converting hour/minute config to the
   manager's seconds.
2. **The ADR-0013 matrix extension** — one predicate in the human-owned
   `scope-checker.ts`: admin `create/update/delete` now covers
   `module ∈ {identity, people}`.

Both were minimal, isolated in `4011168`, and flagged in
`docs/review-gate-3.md` for ratification. On review the diffs match their
descriptions exactly and the conformance suite is green (75 cases,
fourteen new pinning the extension and its non-goals). **Both are ratified
as of 2026-07-05.**

The concern this ADR answers: the *smallness* of the second diff ("just
one line") could become a precedent that erodes the human-owned boundary
one small edit at a time. A one-line license is still a license.

## Decision — standing rule for edits to human-owned paths

1. **Authorization to "proceed without human changes" does not transfer
   ownership.** The default under ADR-0012 is unchanged: Fable does not
   edit `core/**` (implementations or `conformance/**`). A matrix or core
   deadlock is *surfaced to the human*, not worked around.
2. **Diff size is never a justification.** "One line" gets the exact same
   process as a large change — the boundary is about *who reviews*, not how
   much changed. There is no fast path for small edits.
3. **An exception requires ALL of:**
   - (a) explicit owner authorization for *that specific change* — not a
     standing or blanket grant;
   - (b) an ADR recording the decision, the rejected alternatives, and the
     non-goals;
   - (c) the change listed in that release's review-gate under "executed
     under owner authorization / requires ratification";
   - (d) the diff minimal and isolated in its own commit;
   - (e) conformance cases pinning both the new behavior AND its non-goals;
   - (f) **human ratification before the change counts as accepted.**
4. **Ratification is a human act.** Fable may prepare and transcribe the
   ratification but may not self-ratify. The ratifying human is named and
   dated. Per ADR-0012, passing conformance is necessary, not sufficient —
   acceptance is conformance **and** comprehension.
5. **The administrative-module set is closed.** Adding any module to admin
   writability (as #3 did for `people`) is itself a new ADR + conformance
   change under this rule. No module piggybacks on naming to gain
   write authority (restates the ADR-0013 consequence).

## Consequences

- The #3 precedent is **bounded**: it authorized two specific, now-ratified
  edits — not a general license to touch human-owned files.
- Future "it's only one line" temptations hit the full gate above; the
  cheapest-looking change and the largest are controlled identically.
- ADR-0012's ownership mechanics stand unchanged; this ADR adds the
  change-control rule for the exception path that ADR-0013 first exercised.
