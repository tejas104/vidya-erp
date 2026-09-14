# ADR-0025: Tenant-scoped institution audit log

- **Status:** Accepted
- **Date:** 2026-09-14

## Context

`GET /api/v1/system/audit` exposes operationally sensitive event details. The
original audit table had no organization column, so an institution administrator
could receive events belonging to another institution.

## Decision

Audit events may carry a trusted `OrgPath`, persisted in the system-owned
`sys_audit_log.org` JSON column. The institution-facing API first queries only
the caller's authorized college identifiers and then checks every returned row
with the shared `ScopeChecker`. Rows without a trustworthy organization are
operational-only and are not returned by this API.

Migration `system/0003_audit_scope` is a nullable expansion for compatibility.
It backfills only old events whose college identifier is directly present in a
known server-generated payload. It does not guess organization from actor or
resource identifiers. The table's append-only trigger is disabled only while an
exclusive migration lock is held, then immediately restored.

## Consequences

- New institution-visible actions must attach the resolved resource `OrgPath`
  to their audit result. School term, assessment configuration, assessment, and
  marks mutations do so.
- Historical/global events with unknown scope remain available to internal
  operational readers but are hidden from institution administrators.
- Adding the nullable column is safe for mixed application versions; old code
  keeps writing unscoped events, which fail closed in the UI.

## Verification

The database-backed containment test writes own-college, foreign-college and
unscoped events, then proves that the institution admin receives only the first.
Mutation proof removed the handler's second scope filter: exactly the
foreign-candidate unit case failed (17 passed / 1 failed). Restoring it returned
18/18 unit tests and 2/2 audit integration tests to green.
