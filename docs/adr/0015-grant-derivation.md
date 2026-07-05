# ADR-0015: Grant derivation & propagation (assignments → identity grants)

- **Status:** Accepted — ⚠ the security-relevant seam of #3; flagged for
  explicit human review in docs/review-gate-3.md
- **Date:** 2026-07-05

## Context

Per the approved policy, a teacher's authority follows their classroom
assignments: assigning a teacher to a class must produce the corresponding
scope grant, and unassigning must take it away — with #2's invariant intact
(authority never changes mid-session).

## The derivation map

| Assignment | Derived grant |
|---|---|
| `subject_teacher(class C, subject S)` | teacher-role grant `{college, department, class C}` + subject S |
| `class_teacher(class C)` | class_teacher-role grant `{college, department, class C}` |

Grants are **class-level — never section-narrowed** (approved policy), and
are created `verified=true` (their org ids come from real people rows).

## Mechanics

- **Provenance:** identity migration 0001 adds `source
  ('manual'|'derived')` and a unique `source_ref`
  (`people:assignment:<id>`) to the grants table, with a CHECK tying the
  two together. One assignment ⇔ at most one derived grant.
- **The only write path** is identity's public `derivedGrants` API
  (`upsert` / `removeBySourceRef` / `listBySourcePrefix`), which: is
  idempotent; ensures role membership (assigning someone as a subject
  teacher makes them a `teacher` — role REMOVAL stays a manual admin act);
  invalidates the affected user's sessions on every change (both users,
  when an assignment moves between teachers); audits with the sourceRef.
  Manual grant administration cannot touch derived rows (409: "change the
  assignment instead"), and derivation cannot touch manual rows.
- **Ordering & compensation:** assignment create writes the row, then
  derives; a failed grant call deletes the row and fails the request — the
  source of truth and the authority never diverge silently in either
  direction. Deletion reverses the order (grant first, then row).
- **Unlinked/inactive teachers derive nothing.** Linking an identity user
  (audited admin action) or reactivating triggers `syncTeacher`, which
  converges that teacher's grants both ways; unlinking or deactivating
  removes them the same way.
- **The safety net:** an hourly worker job (`people/grant-reconcile`, also
  runnable on demand) recomputes the desired set from assignments and
  converges identity to it — missing grants recreated, orphans removed —
  auditing repairs (`people.grant-reconcile-repaired`) and staying silent
  on clean passes. Verified end-to-end in integration (a grant deleted
  behind identity's back reappears).

## Failure modes considered

| Scenario | Outcome |
|---|---|
| Identity down during assignment create | Row compensated, request fails; nothing to reconcile |
| Grant deleted out-of-band | Hourly reconcile recreates it (audited) |
| Assignment row deleted out-of-band (SQL surgery) | Reconcile removes the orphan grant (audited) |
| Teacher re-linked to a different user | `syncTeacher` moves grants; both users' sessions invalidated |
| Class deleted under an assignment | Impossible via API (RESTRICT); if forced, desiredGrantFor resolves null and sync removes the grant — fails closed |

## Consequences

- The permission a teacher holds is always explainable by an assignment
  row (or a manual grant, distinguishable by `source`) — auditable
  authority.
- Academic-year rollover: old-year assignments keep granting until removed;
  the year-end operational step is bulk assignment cleanup (runbook), a
  future candidate for tooling in the academics module.
