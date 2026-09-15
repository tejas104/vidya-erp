# Lifecycle (proposed)

**Status: PROPOSED.** State names match `GuardianInvitation.status` and
`StudentGuardianRelationship.status` in entity-model.md.

## Invitation → verification → activation

```
                issue                 activate (success)
   (none)  ───────────────▶ pending ───────────────────────▶ activated
                               │  │                              │
                               │  │ expiresAt reached             │ creates/links
                               │  ▼                                ▼
                               │ expired                    StudentGuardianRelationship
                               │                              (status: pending → active)
                               │ staff revokes before use
                               ▼
                             revoked
```

1. **Issue.** An authorized staff member (permission-matrix.md, Part B)
   creates a `GuardianInvitation` for a specific `(studentId, collegeId,
   relationshipType, contactMethod, contactValue)`. Audited. Rate-limited
   per §8.3 ("extend rate limiting beyond login to invitation... endpoints").
2. **Deliver.** Out of scope for this proposal — an SMS/email provider is a
   purchased dependency (§5.3) the identity/authentication owner selects.
   This proposal only requires that the delivered link/code is
   single-use-checkable (the invitation's `status`) and short-lived
   (`expiresAt`).
3. **Verify.** The recipient proves control of `contactValue` (an OTP or
   equivalent — mechanism is the authentication owner's choice, §5.3:
   "the authentication owner should choose the supported login mechanism").
   Verifying control of a phone/email proves control **at that moment**; it
   is evidence for *this* activation, never grounds to auto-link to any
   *other* guardian record — see entity-model.md, "shared phones."
4. **Activate.** On successful verification and before `expiresAt`:
   - the invitation transitions `pending → activated` (single-use: a second
     activation attempt against the same invitation is rejected regardless
     of whether the first succeeded, expired, or was revoked — "expired or
     reused invitations" in the conformance cases covers all three);
   - either a new `GuardianRecord` is created, or — only if the activating
     person is already an authenticated, existing guardian adding a new
     child — the existing record gains a new relationship; a brand-new
     signup never silently attaches to an existing record by contact-value
     match alone;
   - a `StudentGuardianRelationship` is created in `status: pending` and
     immediately advanced to `active` once the school-configured
     verification bar (`verificationState`) is met — for a plain
     self-service invitation, `self-attested` is proposed as sufficient to
     reach `active`; a school that requires in-person confirmation for a
     given relationship type can hold it at `pending` until a staff member
     marks it `staff-verified` (open decision: which relationship types, if
     any, require this — entity-model.md leaves the default open).

## Relationship lifecycle

```
   pending ──(verification bar met)──▶ active ◀────────────┐
                                          │  │              │ staff removes
                       staff adds a       │  │ staff        │ the restriction
                       restriction        │  │ revokes
                                          ▼  ▼              │
                                     restricted ─────────────┘
                                          │
                                          │ staff revokes
                                          ▼
                                       revoked
   active/restricted ──(validUntil reached, or transfer w/o extension)──▶ expired
```

- **`active → restricted`** and **`restricted → active`**: staff-only
  (permission-matrix.md), always with a recorded `note`. A restriction never
  needs to pass through `revoked` — it is a narrowing, not a termination.
- **`active/restricted → revoked`**: staff-only. This is the highest-stakes
  transition in the model and carries two properties, both binding:
  1. **It takes effect immediately, not at next login.** ADR-0010 already
     establishes this exact principle for staff grants ("every
     role/scope/status change invalidates the user's sessions... a changed
     authority takes effect at next login, never mid-session with stale
     grants"). Strategy §5.2's acceptance criterion is the same promise:
     "revocation removes access promptly, including an existing session."
     See open-decisions.md for why this proposal recommends achieving that
     promise **without** reusing the coarse `invalidateAllForUser` — a
     guardian can have several children, and revoking access to one must
     not sign them out of the others.
  2. It is audited with actor + reason, and the relationship row is kept
     (not deleted) — history survives the revocation, per §5.2's "without
     erasing history."
- **`→ expired`**: automatic, when `validUntil` passes, or when the
  student's enrollment ends and no `historicalAccessUntil` window was set
  (or that window also passes). Expiry is not revocation: no staff actor,
  no `revocationReason`, and (proposed) a gentler UX than an abrupt
  revocation, since it was a planned, known boundary from `validFrom`
  onward.
- **Transfer and permitted historical access.** When a student transfers to
  a different college/tenant or leaves the school, their *live* enrollment
  ends. Proposed treatment: the relationship moves toward `expired` on the
  original college's live categories, but MAY carry a `historicalAccessUntil`
  date during which the guardian can still *read* records exactly as they
  stood before the transfer (report cards already published, past
  attendance) — never anything created afterward, and never on the new
  college if the student re-enrolls elsewhere (that is a fresh relationship,
  proposed to require a fresh invitation, not an automatic carry-over).

## Account recovery

Strategy §5.3, verbatim: "Recovery must verify authority to access the
child, not merely knowledge of their name or admission number." This
proposal treats guardian recovery as **at least as strong as**, never weaker
than, whatever the identity owner requires for staff/student account
recovery, plus one guardian-specific rule:

- Recovery MUST NOT be satisfiable by supplying the student's name,
  admission number, or any other fact a stranger could plausibly obtain
  (a report card left in a bag, a classmate's parent, a school directory
  leak). Those identify the *child*, not the *guardian's authority* over
  them.
- Proposed baseline: recovery re-runs a real proof-of-contact step (a fresh
  OTP to a phone/email already on file for that `GuardianRecord` — not one
  supplied fresh by the requester) OR falls back to the same staff-mediated
  re-verification an invitation activation would use. Which of these (or
  both, tiered by risk) is the identity/authentication owner's call — this
  proposal does not implement either, only requires that "I know the
  child's name and admission number" is never sufficient on its own.
- A changed contact detail (new phone number on an *existing, active*
  relationship) is an authenticated-guardian self-service update to their
  own `GuardianRecord`, audited, and — per entity-model.md — never itself a
  vector for transferring or merging anyone's access.

## Actors authorized per transition (summary)

| Transition | Actor |
| --- | --- |
| Issue invitation | Staff (permission-matrix.md, Part B) |
| Verify contact | The invited person (self, via the auth owner's chosen mechanism) |
| Activate → relationship `pending`/`active` | The invited person (self), gated by the verification step above |
| `pending`/`active` ⇄ `restricted` | Staff only |
| → `revoked` | Staff only |
| → `expired` | System (automatic, date/enrollment-driven) — no human actor |
| Update own contact details | The guardian, self-service, on their *own* `GuardianRecord` only |
| Recovery | The guardian, gated by a proof-of-authority step (above) — never staff *granting* recovery by assertion alone, though staff-mediated re-verification may be one such step |
| Merge two records | Staff (`admin` only, permission-matrix.md) |
| **Create or expand one's own relationship** | **Nobody, self-service.** This is not merely "not implemented" — it is the specific privilege-escalation case this proposal must positively deny: see `guardian-contract/cases.ts`. |
