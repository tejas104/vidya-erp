# ADR-0011: Session transport, CSRF posture, throttling, reset flow

- **Status:** Accepted
- **Date:** 2026-07-04

## Sessions

Redis-backed sessions (Constitution rule 10) issued by the HUMAN-OWNED
SessionManager; the module contributes only transport and policy:

- **Cookie:** `vidya_session`, `HttpOnly; SameSite=Strict; Path=/;
  Max-Age=<ttl>; Secure` (Secure droppable only via config for plain-http
  local dev; compose sets it false, production keeps true).
- **Windows:** 12h absolute TTL, 30m sliding idle (config), enforced by the
  SessionManager and verified by its conformance suite.
- **Snapshot semantics:** roles + grants are captured at issue; every
  authority change (roles, grants, status→disabled, password change/reset)
  calls `invalidateAllForUser` — no stale-privilege sessions.
- **Hot path:** the authenticator does zero DB reads; resolve() is one
  Redis round-trip.

## CSRF

Two independent layers, both active:

1. `SameSite=Strict` on the session cookie (browsers don't attach it
   cross-site at all).
2. The pipeline's origin guard: state-changing requests carrying an
   `Origin` header must match the request's own origin or the
   `TRUSTED_ORIGINS` allowlist → otherwise 403. Non-browser clients (no
   Origin header) pass — they can't be CSRF'd.

Double-submit tokens are deliberately deferred until a browser UI exists;
revisit in the module that ships one.

## Login throttling

Fixed-window failure counters in Redis (shared across replicas), keyed
`username|client-ip` for login and `client-ip` for reset-token redemption:
5 failures / 15 minutes (config) → 429 with Retry-After; a successful login
clears the subject. Failures and lockouts are audited. Client IP comes from
the first `x-forwarded-for` hop (the on-prem reverse proxy's value) with a
shared "direct" bucket as fallback — see the identity threat model for the
trust caveat.

## Password reset without a mailer (approved decision #4)

Admin-initiated only: `POST /users/{id}/password-reset` (admin) returns a
one-time token to the admin, exactly once, never logged or audited; only
its SHA-256 is stored, with a 30-minute TTL. Redemption is public
(possession of the token is the credential), throttled per IP, single-use,
sets the account active and kills all sessions. Self-service email reset
arrives with the notifications module via a documented delivery contract.
An hourly worker job purges stale tokens.

## User enumeration resistance

Unknown-user, wrong-password and disabled-account all return the same 401
body; unknown users burn a verification against `PasswordHasher.dummyHash`
so timing is comparable. The only credential-confirming divergence is
`must_reset` (403 after a correct password) — accepted: it reveals nothing
to a caller who doesn't already hold the credential.
