# Permission matrix (proposed)

**Status: historical S03 proposal.** ADR-0027 and the current route definitions
supersede the proposed staff-role table in Part B (especially invitation,
verification and revocation roles). Part A remains the design input for the
guardian adapter; its implemented behavior is pinned by adapter conformance
tests. This document mirrors the presentation of ADR-0010's matrix
deliberately (same table shape, same "deny-by-default" framing) because
that matrix is the platform's one ratified authorization document and
reviewers already know how to read it. This is not an extension of that
matrix — it is a companion document for a relation ADR-0010 does not cover
(see boundaries.md for why).

## Part A — guardian operations (the new relation)

A guardian's authority for a given student comes **only** from an
`active` (or `restricted`, narrowed) `StudentGuardianRelationship` row
whose `collegeId` matches the resource and whose `grantedCategories`
includes the resource's category. No relationship ⇒ no access, full stop —
deny-by-default, same as ADR-0010.

| Category | Read | Write / act | Export | Direct file access | Bulk (multi-student) |
| --- | --- | --- | --- | --- | --- |
| Attendance summary | ✅ if relationship active + category granted | — | ❌ never | ❌ never (mediated fetch only, re-checked per request) | ❌ never |
| Marks / report card | ✅ **published only** (never draft/validated/approved/withdrawn) | — | ❌ never | ❌ never | ❌ never |
| Fees (dues, receipts) | ✅ if relationship active + category granted | — | ❌ never | ❌ never | ❌ never |
| Notices / homework | ✅ if relationship active + category granted | `acknowledge` ✅ | ❌ never | ❌ never | ❌ never |
| Leave request | — | `submit-leave-request` ✅ (creates a request; does not itself grant any read beyond the request's own status) | ❌ never | — | ❌ never |
| Timetable | ✅ if relationship active + category granted | — | ❌ never | ❌ never | ❌ never |
| Guardian-relationship record itself | ✅ own relationships only (read-only "which children am I linked to, what categories, what restrictions") | ❌ **a guardian may never create, expand, or modify their own relationship** — see the privilege-escalation cases | ❌ never | — | — |

Notes binding the whole table:

- **"Published only" is load-bearing**, not a detail. Strategy §5.6 defines
  a report-card lifecycle (draft → validated → approved → published →
  superseded → withdrawn) precisely so "generation is not publication." A
  guardian resource check must read the artifact's `publicationState` and
  deny for every state except `published`; a `withdrawn` report reverts to
  denied for the withdrawn artifact itself (a permitted correction notice,
  if any, is a *different*, narrower resource — not modeled further here).
- **`export` is never granted to a guardian**, at any relationship state,
  for any category. ADR-0010 restricts staff `export` to hod/principal/admin
  as a bulk-exfiltration control; guardians get no equivalent at all — not
  even a single-child export — because a guardian-shaped export is exactly
  the shortcut §5.2 forbids ("do not grant a guardian a broad... scope as a
  shortcut") wearing a different hat.
- **Direct file access is never a standing grant.** A "give me the PDF"
  action must re-run the same category+state check as `read` at fetch time,
  every time — a previously-valid signed URL, deep link, or cached path must
  not outlive or bypass the relationship it was issued under. §8.4's "Notice
  attachment requested by other section: access denied even if URL is
  known" is the same invariant one level up; the analogous guardian case is
  in `guardian-contract/cases.ts`.
- **Bulk (multi-student) requests are never granted.** A guardian with
  several children switches *context* per request (see "child selector,"
  lifecycle.md) — the server always resolves one `studentId` per call and
  checks it independently. There is no "give me all my children's records
  in one call" operation; adding one later is a new, explicitly-reviewed
  capability, not an emergent side effect of looping the single-child check.
- **Restrictions only narrow.** A `restricted` relationship still passes
  every check a `restriction` entry does not name; it never grants anything
  an `active` relationship without restrictions wouldn't already grant.

## Part B — staff operations that manage guardian relationships

These are ordinary **people-module** resources (per ADR-0014, people already
owns students/enrollment), so they should follow the **already-ratified**
ADR-0024 pattern exactly — containment via the existing `ScopeChecker`
first, then a people-module-owned role predicate — rather than inventing a
new mechanism:

```ts
function guardianManagementWriteAllowed(principal: Principal, org: OrgPath): boolean {
  if (!scopeChecker.check(principal, "read", { module: "people", resourceType: "guardian-relationship", org }).granted) {
    return false; // shared checker still decides tenancy/containment, unchanged
  }
  return /* module-owned role predicate, proposed below */;
}
```

| Operation | Proposed roles | Rationale (proposed, needs confirmation) |
| --- | --- | --- |
| Issue an invitation for a student | `admin`, `principal`, `class_teacher` (of that student's class) | Matches who already has legitimate contact with a family; narrower than "any teacher" because inviting creates a standing relationship. |
| View a student's guardian relationships (read) | `admin`, `principal`, `class_teacher`, `hod` (within existing containment) | Read follows the same containment ADR-0010 already grants for other people-module records at each role. |
| Revoke a relationship | `admin`, `principal` | More sensitive than issuing — proposed narrower set. **Open question:** should `class_teacher` also revoke, symmetric with inviting? See open-decisions.md. |
| Add/remove a restriction | `admin`, `principal` | Custody-sensitive; proposed narrowest set. |
| Merge two `GuardianRecord`s (confirmed same person) | `admin` only | Highest-risk operation in this whole model — see entity-model.md's "shared phones" section. Always audited, never automatic. |
| Correct a mistaken link (wrong student) | `admin`, `principal` | §5.2: "correct a mistaken link... without erasing history" — implemented as revoke-and-recreate with both old and new rows retained, mirroring how `ppl_enrollments` handles transfers (ADR-0014: "withdraw-then-create, audited with both sides"), not an in-place mutation. |

Every operation in Part B is subject to **existing, unmodified** containment
(`ScopeChecker.check`) exactly as ADR-0024 requires — nothing above widens
`admin`'s already-ratified `people`-module write authority (ADR-0013) or
introduces a bespoke path comparison (the thing ADR-0024 explicitly
forbids). The *only* new thing is the role predicate naming which of the
existing roles may act on this specific new resource type, which is exactly
the kind of module-local decision ADR-0024 already sanctions without
touching `identity/src/core/`.

## What is deliberately absent from both parts

- No guardian ever appears in `Principal.roles` or `ScopeGrant` in this
  proposal. See boundaries.md for why that would be the wrong fix even if
  it were allowed.
- No "guardian-admin" super-role that manages other guardians' relationships
  — every management operation in Part B is a **staff** operation, gated
  the staff way.
- No blanket `export`, ever, for a guardian, under any relationship state.
