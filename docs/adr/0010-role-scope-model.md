# ADR-0010: The role + scope authorization model

- **Status:** Accepted (permission matrix approved by the human owner, Vidya #2)
- **Date:** 2026-07-04

## Model

A user holds one or more **roles** (`admin`, `principal`, `hod`,
`class_teacher`, `teacher` — closed set, no hierarchy) and a set of
**scope grants**. A grant = (role, org path, optional subject): the org
path targets the tree module #3 will own (college → department → class →
section) using **opaque string identifiers** (≤64 chars, the #3 identifier
contract; never foreign keys). Authority comes ONLY from grants — role
membership without a grant conveys nothing.

Grant shapes (enforced by zod at the API and CHECK constraints in
`idn_scope_grants`): teacher → class-or-section + subject; class_teacher →
class-or-section, no subject; hod → department exactly; principal/admin →
college exactly. Section implies class implies department (path check).
A composite FK onto `idn_user_roles` guarantees a grant's role is held and
cascades grants away when the role is revoked.

## The approved permission matrix (binding spec for the scope-check)

| Role | Read | Write |
|---|---|---|
| teacher | non-subject records in their attached class/section, plus **their own subject's** records — other subjects' marks are private to their teachers (human-directed revision, 2026-07-04) | create/update/delete **their own class+subject records** only |
| class_teacher | their class(es), all sections/subjects | their class's **non-subject** records (attendance, conduct, promotion); never subject marks |
| hod | their entire department | department-level **approve** only; no routine entry |
| principal | college-wide | none (pure viewer) |
| admin | college-wide (support) | **identity records only** (users/roles/grants); never academic records |
| anyone | own profile (`ownerUserId` self-access) | — |

Deny-by-default: no match → denied with a reason.

**Conventions the matrix relies on:** a record carrying `subjectId` is a
"subject record" (marks); records without it are non-subject records.
`approve` is the only write verb hod holds; `export` follows read scope but
only for hod/principal/admin (bulk-exfiltration control — Fable-specified,
flagged for confirmation in docs/review-gate-2.md).

## The chokepoint

`ScopeChecker.check(principal, action, resource)` — interface in
`@vidya/platform`, implementation **HUMAN-OWNED** (ADR-0012). Pure,
synchronous, deterministic, no I/O: grants ride in the session snapshot on
the `Principal`; the calling module describes its record's org position in
a `ResourceRef`. The executable form of this matrix is the conformance
suite `packages/modules/identity/src/core/conformance/scope-checker.ts`
(60+ cases) — any implementation change that flips a case is a
Constitution-level event requiring human review.

Because grants snapshot into sessions, **every role/scope/status change
invalidates the user's sessions** (UsersService rule) — a changed authority
takes effect at next login, never mid-session with stale grants.

## Org identifiers before #3 exists

Grants store operator-supplied identifiers verbatim with `verified=false`
and an audit trail of who supplied them. The `OrgDirectory` contract
(platform) is the verification seam #3 implements; a backfill re-verifies
existing grants then. Risk accepted: a typo'd org id yields a grant that
matches nothing (fails closed, never open).
