# ASSIGNMENT #11 — Scoped Search Endpoints, Route Completion, CSP Enforcement, Debt Paydown

**PRECONDITION:** #10 (all five Parts) and #10.5 (all four Parts) complete and merged;
full e2e green (26 journeys). If the branch `feat/a10-remainder-a105-security` is not
merged, STOP and report — do not build on an unmerged base.

**HARD BOUNDARY:** `PasswordHasher`, `SessionManager`, `ScopeChecker` implementations
(`packages/modules/identity/src/core/`) remain human-owned — consume interfaces only.
Part 4 below *deliberately* asks you to hit that boundary and report the interface gap
rather than cross it.

**WHY THIS ASSIGNMENT EXISTS:** #10 and #10.5 recorded five gaps at their code seams
that could not be closed under a presentation-only constraint. This assignment closes
them, and pays down the debt those two assignments surfaced. Every item below traces to
a specific recorded finding, not a hypothetical.

---

## PART 1 — SCOPED SEARCH ENDPOINTS (closes the O(n) prefetch)

Recorded at `apps/web/src/ui/search/searchIndex.ts`:
> `ponytail: O(sections) roster requests on first open, pooled at 6; holds to ~1-2k
> students. Real fix = scoped students?q= endpoint scheduled on #11.`

Global search currently builds its index by fetching **every section's roster** on first
open. It works to ~1–2k students and then stops working.

- Add a scoped `students?q=` search endpoint: server-side match on name and admission
  number, respecting the caller's existing scope grants — **reuse `ScopeChecker`, do not
  re-implement scoping**. Returns the same minimal projection the client index already
  uses (name, roll, section, href); **never** phone, guardian, or DOB. There is an
  existing test asserting no PII reaches the index — keep it passing and extend it to
  the new endpoint.
- Add a scoped **staff-list** endpoint. `identity.listUsers` is ADMIN_ONLY, which is why
  #10's staff search works for admins only. Principals, HODs and class teachers have a
  legitimate need to find colleagues; scope it to what each role may already see.
- Rewrite the client index to query these endpoints with debounce instead of
  prefetching rosters. Delete `mapPool` if it has no remaining consumer.
- **Measure and report**: first-open latency and request count, before and after, at the
  demo seed's size.

## PART 2 — PER-TEACHER ROUTE (closes the staff-search dead end)

Recorded in the same file: every staff search hit currently lands on `/manage/teachers`
because no per-teacher page exists.

- Add a per-teacher profile route reachable by direct link, mirroring how
  `/students/[studentId]` works today (full page for direct links; the SlideOver opens
  from table rows).
- Wire staff search results to it.
- Scope rules unchanged — the page shows exactly what the caller's scoped endpoints
  return, and a teacher viewing a colleague sees only what they are permitted to.

## PART 3 — ENFORCE CSP

#10.5 Part 3 shipped CSP **report-only**. Two un-nonced inline scripts in
`apps/web/app/layout.tsx` block enforcement: line 49 `themeScript` (theme-flash guard,
pre-existing) and line 50 `swScript` (service-worker registration, added by #10's PWA work).

- Move `swScript` to a static `/sw-register.js`.
- Nonce or hash `themeScript` — it must keep running before first paint, or the
  theme-flash it exists to prevent comes back. Verify that in a browser, not by reading.
- Flip CSP from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.
- Update the `#10.5` security guard that asserts the report-only header.
- Document the final policy in `SECURITY.md`, replacing the "known limitation" entry.
- **If a strict `script-src` still cannot be expressed** (Next.js inline bootstrap,
  third-party embeds), STOP and report exactly what forces the compromise rather than
  shipping `'unsafe-inline'` silently.

## PART 4 — SESSION POLICY (expected to STOP)

#10 Part 3 asked for a mobile-appropriate session length. It was reported, not built:
`SessionManager` exposes a single global TTL with no per-device or per-role seam.

- Determine precisely what interface change would be needed on `SessionManager` to
  support per-role or per-device session policy.
- **Do NOT modify the implementation.** Write the proposed interface delta, the call
  sites it would affect, and the security implications (a longer mobile session is a
  larger stolen-device window — say so).
- Deliver it as a short ADR for the owner to accept or reject by hand.

## PART 5 — DEBT PAYDOWN (pre-triaged by the S2b final review)

All of these were triaged DEFER by a prior review and are now due. Details in
`.superpowers/sdd/s2b-final-review.md`:

- **I4 remainder**: dedupe `.formGrid` (×13), `.confirmMessage` (×9), `.skeletonStack`
  (×7) across page modules; add a ui-system `Textarea` to retire the four hand-rolled
  `.field`/`.label`/`.textarea` copies.
- **M1**: delete the vestigial legacy `ToastProvider` from `app/(app)/layout.tsx` — it
  has zero real consumers since B1 and renders a dead second `aria-live` region on every
  page. Then `Toast.tsx` and the `.ui-toast*` CSS.
- **M2**: give ui-system `Button` an `as`/`asChild` prop so download links stop needing
  `.btn ghost`; convert the three remaining legacy `<button className="btn">`
  (`attendance:221`, `classes:366`, `dashboard:415`).
- **M7**: add `rowKey` to ui-system `Table` before any sortable table gets a stateful cell.
- **`.cw-photo` AA gap**: `globals.css:930` hardcodes `color:#fff` for avatar initials,
  which fails AA on the amber/green/cyan palettes. `avatar.ts` already carries a
  per-palette `ink` — thread it through.

## PART 6 — REPO HYGIENE (three known-broken things)

- **Docker images are broken**: `migrate`/`web`/`worker` fail with `Cannot find package
  'prom-client'`. Local `pnpm build`/`start` works, so this is packaging only — but it
  means the compose stack cannot actually run the app. Fix and prove with a clean
  `docker compose up` that serves a request.
- **`pnpm -r typecheck` fails** on `@vidya/module-academics` (`handlers.test.ts:288`
  mock) — pre-existing since at least S1.
- **Root `tsc` fails** on `tests/integration/syllabus-flow.int.test.ts:165`
  (`.json()` returns `unknown`).
  Both have been "known pre-existing" for several assignments. Fix them, or delete the
  scripts that pretend to check them.

---

## VERIFICATION (evidence, not intent)

1. Full e2e green — the 26 existing journeys unchanged, plus new coverage for the
   scoped search endpoints and the per-teacher route. Attach output.
2. **Search scaling**: before/after request count and first-open latency, measured.
3. **PII proof**: the existing no-PII assertions still pass and now cover the new
   endpoints; show the grep and the test.
4. **CSP enforced**: `curl -I` showing `Content-Security-Policy` (not report-only), plus
   a browser check that no console violations fire on login, dashboard, attendance and
   portal — and that the theme still doesn't flash.
5. `git diff --stat` proving `packages/modules/identity/src/core/` is untouched.
6. `docker compose up` serving a real request.
7. `pnpm -r typecheck` and root `tsc` both clean — no "known pre-existing" exceptions left.
8. Explicit list of every STOP condition hit, with the exact interface gap.
