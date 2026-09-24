# ADR-0028: Family publication of school report cards

- **Status:** ACCEPTED for the school-first implementation
- **Date:** 2026-09-24
- **Related:** ADR-0020, ADR-0027

## Context

Generating a school report card creates an immutable academic snapshot. A generated card is not automatically suitable for family release: marks or attendance may be incomplete, and staff may need to correct and regenerate it. Families need an explicit release decision that can later be superseded or withdrawn without changing the issued record.

## Decision

1. Report-card generation leaves the snapshot private. An admin or principal with a matching current admin or principal grant over the pupil must explicitly publish a specific snapshot after reviewing its PDF. A class teacher may prepare and download snapshots within scope, but cannot release them to families. An unrelated leader role combined with a teacher grant does not authorize release.
2. Publication and withdrawal append events to a reporting-owned table. The latest event for a pupil and term determines the one currently visible snapshot. This trail is database-enforced append-only; report-card snapshots remain untouched. Publishing a later snapshot supersedes the earlier family view. Withdrawal removes the current family view while retaining all issued snapshots and staff access.
3. A family list and PDF download require a fresh guardian relationship decision for the `report-card` category with state `published`. The PDF route additionally verifies that its snapshot is the current publication for the requested child. Unknown, unrelated, withdrawn, superseded, and unpublished snapshot IDs never return document bytes.
4. The publication routes and family downloads are audited. School staff can still download any issued snapshot within their current scope, independent of family publication.

## Consequences

The family page displays only currently released cards. A newly generated correction stays private until school leadership publishes it. Families can lose access immediately on relationship revocation or withdrawal. A school should review the issued PDF before publication because the on-screen preview can be older than the immutable snapshot if marks change concurrently.
