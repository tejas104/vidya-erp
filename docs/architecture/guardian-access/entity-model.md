# Entity model (proposed)

**Status: PROPOSED.** Field names, cardinalities and states below are a
starting point for identity-owner review, not a schema. No migration exists
or is implied. Typed equivalents (for the conformance cases, not for
persistence) live in
[`packages/modules/people/src/guardian-contract/types.ts`](../../../packages/modules/people/src/guardian-contract/types.ts).

## Why a new entity, and where it would live

Today `ppl_students` carries `guardianName`/`guardianPhone` as two free-text
columns (`packages/modules/people/src/db/schema.ts`) — enough for a phone
call, not enough for authorization. Strategy §5.2 asks for a real entity and
an explicit relationship, "modeled independently from a phone number,"
because shared phones, a changed number, two guardians, and siblings are all
normal cases a single text column cannot represent.

Both proposed tables would be owned by the **people** module (it already
owns the org tree, students, and enrollment — ADR-0014) — hence
`packages/modules/people/src/guardian-contract/` as this proposal's code
home. They are new tables; no existing table changes shape.

## GuardianRecord

One row per real person acting as a guardian, independent of how many
children they are linked to and independent of any specific college.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | opaque string (`grd_…`) | Per the existing `ppl` id convention (`packages/modules/people/src/ids.ts`) — never parsed for meaning. |
| `tenantId` | opaque string | See [boundaries.md](boundaries.md). Not `collegeId` — a guardian's record is not anchored to one college, because siblings can attend different colleges in the same tenant. |
| `identityUserId` | opaque string, nullable | Cross-module link to the identity user, exactly like `ppl_teachers.identity_user_id` (ADR-0014) — **no foreign key** (Constitution rule 2). Null until the guardian activates an invitation; a guardian record may exist (from a school's own roster import) before any login does, mirroring how a teacher record can exist before its account. |
| `fullName` | string | As the school records it. |
| `primaryPhone` | string, nullable | A contact channel, not an identifier — see "Shared phones" below. |
| `primaryEmail` | string, nullable | Same caveat. |
| `status` | `"invited" \| "active" \| "suspended" \| "deactivated"` | Account-level status, distinct from any one relationship's status. A suspended guardian loses access to *every* child, not one. |
| `createdAt` / `updatedAt` | timestamp | — |

**Store the minimum supporting evidence necessary; do not collect identity
documents by default** (§5.2, verbatim). No field here holds a document
scan, a government ID number, or biometric data. If a specific school's
custody dispute genuinely requires stronger evidence, that is a targeted,
audited exception recorded as a `GuardianRestriction` note (below) with an
opaque `evidenceRef` pointing at object storage under the SAME retention and
access controls as any other sensitive file — never a default field every
guardian record carries.

### Shared phone numbers do not merge identity

Two different `GuardianRecord` rows MAY carry the same `primaryPhone`. A
phone number is a delivery address, not a key. The system must never infer
"same phone ⇒ same person" and silently attach one guardian's relationships
to another's login, or silently merge two records. The only way two records
become one is an explicit, audited staff action (`admin`-only, proposed —
see [permission-matrix.md](permission-matrix.md)) after some out-of-band
confirmation the school is satisfied with. Verifying control of a phone
number (receiving an OTP) proves control of that phone *at that moment*; it
never proves — and must never be treated as proving — that two prior
guardian records belong to the same person.

This also covers the acceptance criterion "changing a phone does not
silently transfer child access" (§5.2): a relationship is keyed to
`guardianId`, never to a phone number. Changing `primaryPhone` on a
`GuardianRecord` is an explicit, audited update to that one record; it
cannot, by construction, touch any other record's relationships, because
nothing about the relationship model reads phone numbers at decision time.

## StudentGuardianRelationship

One row per (guardian, student) pair. A guardian with two children has two
rows; two guardians of one child are two rows referencing the same
`studentId`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | opaque string (`sgr_…`) | — |
| `guardianId` | → `GuardianRecord.id` | — |
| `studentId` | opaque string | Cross-module reference to `ppl_students.id` — no foreign key, same convention as everything else that crosses a module boundary here. |
| `collegeId` | opaque string | The institution this relationship is scoped to (denormalized from the student's college at creation time) — this is what lets siblings at different colleges, in the same tenant, work correctly; see boundaries.md. |
| `relationshipType` | `"parent" \| "legal-guardian" \| "other-authorized-contact"` | Deliberately small and closed. Expanding it (e.g., a distinct "emergency contact, no records access" tier) is an identity-owner decision — see open-decisions.md. |
| `isPrimaryContact` | boolean | Informational/communication-routing, not an authorization multiplier — **a primary contact is not automatically the only authorized guardian** (§5.2, verbatim); every case in the conformance set treats non-primary guardians identically to primary ones for record access. |
| `verificationState` | `"unverified" \| "self-attested" \| "staff-verified"` | How strongly the school has confirmed this is a real relationship, independent of lifecycle `status` below. A newly-activated relationship from a self-service invitation starts `self-attested`; a school that manually confirmed identity in person can mark `staff-verified`. This proposal does not mandate which state is required for which action — that is an identity-owner / school-policy decision (open-decisions.md), but the field exists so the decision has somewhere to live. |
| `status` | `"pending" \| "active" \| "restricted" \| "revoked" \| "expired"` | See [lifecycle.md](lifecycle.md) for transitions. `restricted` means the relationship is real and partly authorized — see `restrictions` below — not a synonym for revoked. |
| `grantedCategories` | set of `GuardianRecordCategory` | Which record categories (attendance, marks, report-card, fees, notices, homework, timetable) this specific relationship covers. Not every relationship type needs the same breadth — e.g. an `other-authorized-contact` might reasonably get notices and pickup-relevant information only, never marks or fees. Proposed default: `parent` and `legal-guardian` get the full read set; `other-authorized-contact` gets a school-configured subset. Exact defaults are an open decision. |
| `restrictions` | list of `GuardianRestriction` | Staff-recorded limits on an otherwise-active relationship — see below. |
| `validFrom` | date | When the relationship starts counting as active (subject to `status`). |
| `validUntil` | date, nullable | Planned end (e.g., end of academic year for a temporary arrangement); null means open-ended subject to enrollment/transfer. |
| `historicalAccessUntil` | date, nullable | A **separate**, narrower window: after a student transfers out or graduates, a guardian's *live* access ends, but read-only access to records **as they stood before transfer** may be permitted through this date — see "Transfer and permitted historical access" in the conformance cases. Distinct from `validUntil` so "still enrolled, relationship ended" and "no longer enrolled, wind-down access" are never confused. |
| `createdBy` / `createdAt` | staff actor, timestamp | Who issued the invitation that led here, or who recorded the relationship directly. |
| `revokedBy` / `revokedAt` / `revocationReason` | staff actor, timestamp, string, all nullable | Populated only when `status = "revoked"`. |

### GuardianRestriction

A named, staff-recorded, audited limit — the mechanism behind "record a
custody restriction... without erasing history" (§5.2).

| Field | Type | Notes |
| --- | --- | --- |
| `category` | `GuardianRecordCategory \| "all"` | What the restriction narrows. |
| `action` | `GuardianAccessAction \| "all"` | Which operation is restricted. |
| `note` | string | Human-readable reason, e.g. "custody order on file, no pickup notifications." Never a substitute for the school's own retained legal documentation — this is a pointer, not the record. |
| `recordedBy` | staff actor | Who added it. |
| `recordedAt` | timestamp | — |

A restriction narrows an otherwise-active relationship; it never widens one.
An empty `restrictions` list plus `status = "active"` is the normal case.

## GuardianInvitation

The precursor to a `StudentGuardianRelationship`. See lifecycle.md for the
full state machine; the shape:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | opaque string (`gin_…`) | — |
| `studentId`, `collegeId` | opaque strings | Which child and institution this invitation is for. |
| `intendedRelationshipType` | `RelationshipType` | What the relationship becomes on activation. |
| `contactMethod` | `"sms" \| "email"` | — |
| `contactValue` | string | The phone/email the invitation was sent to — **not** treated as an identifier once activated (see "shared phones," above). |
| `status` | `"pending" \| "activated" \| "expired" \| "revoked"` | A used-and-consumed token is `"activated"`; a second activation attempt against an `"activated"` (or `"expired"` or `"revoked"`) invitation is always rejected — see the "expired or reused invitations" conformance cases. |
| `expiresAt` | timestamp | Short-lived by design (§8.3: rate-limit and bound invitation endpoints). Exact TTL is a school-policy / identity-owner decision. |
| `issuedBy` / `issuedAt` | staff actor, timestamp | See permission-matrix.md for who may issue. |
| `activatedAt` / `resultingGuardianId` | timestamp, opaque string, nullable | Set only on successful activation. Activation either creates a new `GuardianRecord` or links to an existing one **if and only if** the activating person proves control of an identity the school has already reason to trust is the same guardian (never inferred from a matching phone number alone — see recovery in lifecycle.md). |

## Cardinalities, at a glance

```
GuardianRecord (1) ──< StudentGuardianRelationship >── (1) Student  [opaque ref]
GuardianRecord (1) ──< GuardianInvitation (historical, one row per invite sent)
StudentGuardianRelationship (1) ──< GuardianRestriction (0..n)
```

- One guardian, many children (siblings): many `StudentGuardianRelationship`
  rows sharing one `guardianId`.
- One child, many guardians: many rows sharing one `studentId`.
- A guardian who is also staff: their `GuardianRecord`/`identityUserId` and
  their staff `idn_user_roles`/`idn_scope_grants` are **entirely separate
  records that happen to share the same `identityUserId`** — nothing in
  either model reads the other. See boundaries.md.
