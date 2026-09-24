# ADR-0029: Release of school term marks

- **Status:** ACCEPTED for the school-first implementation
- **Date:** 2026-09-24
- **Related:** ADR-0027, ADR-0028

## Context

The existing portal marks feed reads college assessments. School marks live in the school-academics term model. Families and students need current, term-aware results without seeing scores while teachers are entering or correcting them. Some schools may already have closed terms when this view is deployed; treating every closed row as published would disclose those scores without a new decision.

## Decision

1. School term marks use dedicated student and guardian portal routes. The student route resolves its identity link; the guardian route asks the people module for a fresh `marks` category decision on every request. Both resolve the pupil's enrolled class for the requested academic year, then read school-academics source facts and use its weighted calculation engine. Missing marks never become zero or a partial overall percentage.
2. A term is visible only while closed **and** stamped with `marks_released_at`. A close performed by the new application atomically stamps the marker; reopening clears it and hides the term during corrections. Closing again releases corrected current results. A term with no assessments for the pupil's class does not appear.
3. The migration leaves `marks_released_at` null on existing rows, including closed rows. An administrator with a matching school grant can release one previously closed term through an explicit audited action after reviewing its scores. The action is conditional and cannot release an open or already released term.
4. Report-card PDFs keep the independent snapshot publication workflow in ADR-0028. A current term mark may therefore differ from an older issued PDF. The interface names the two records separately.

## Alternatives considered

- **Closed status alone:** simplest, but silently exposes all historically closed terms during rollout.
- **Require a published report card for every marks view:** uses an existing release event, but ties live scores to immutable PDF issuance and excludes students whose school has not generated cards.
- **Separate publication events for each mark edit:** offers more granular review, but adds a second result workflow without a current school requirement.

## Consequences and rollout

The additive migration must run before the new application reads the column. During a rolling deploy, an older instance can close a term but cannot release its marks; the new instance will show it as private until an administrator releases it. A database trigger clears the marker if an older instance reopens a term. Deployment should confirm old closed rows remain null, and verify one new close, reopen, and explicit legacy release before wider enablement. Rolling the application back hides the new marks routes. Rolling the migration back after release discards marker values, so restore those decisions from the database backup or audit trail before re-enabling the feature.
