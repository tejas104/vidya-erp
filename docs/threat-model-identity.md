# Identity & access threat model (Vidya #2)

Extends docs/threat-model.md. New assets: credentials (hashes), sessions,
reset tokens, the grant store, and the scope-check itself — the mechanism
that will later guard fee and government-identity data.

## STRIDE deltas

| Threat | Vector | Mitigation | Residual / planned |
|---|---|---|---|
| **S**poofing | Credential stuffing / brute force | Redis fixed-window lockout (5/15min per user+IP, audited), argon2 verification cost (human core), uniform 401s, dummy-hash timing equalization for unknown users | IP keying trusts the first XFF hop — see §throttle-keying |
| Spoofing | Stolen/forged session token | HttpOnly cookie (no script access), human-owned signing + Redis backing (tamper → resolve null, conformance-tested), absolute + idle expiry, invalidate-all on any credential/authority change | Token binding (IP/UA) deliberately not done — breaks campus NAT/wifi roaming; revisit on evidence |
| Spoofing | Session fixation | Tokens are only ever minted server-side at login; no session exists pre-auth to fixate; cookie value fully replaced on each login | — |
| **T**ampering | Privilege escalation via grant manipulation | Grants writable only through admin-gated + scope-checked routes; DB CHECK constraints on grant shape; composite FK ties grants to held roles; every change audited with before/after; sessions invalidated on change | Admin compromise = college-wide identity control: mitigate operationally (few admins, audit review runbook) |
| Tampering | Stale privileges after role change | Snapshot-in-session + invalidate-all-on-change rule (integration-tested) | — |
| **R**epudiation | Disputed logins/changes | login (success AND failure), logout, blocked-reset logins, user/role/grant changes, reset issuance/completion/failure all write the append-only audit log with actor + IP where relevant | — |
| **I**nfo disclosure | User enumeration | Uniform invalid-credentials surface + dummy verification; reset confirmation reveals nothing about token validity beyond 401 | Timing of DB user lookup itself differs marginally; accepted at L2 |
| Info disclosure | Reset token leakage | Token returned exactly once to the initiating admin over the API; only SHA-256 stored; never logged/audited; 30-min TTL; single-use; cache-control no-store | Out-of-band delivery (admin → user) is a human procedure; runbook prescribes it |
| Info disclosure | Password material in logs | Config/pino redaction from #1; login bodies are never logged (pipeline logs metadata only); hashes never leave the service layer | — |
| **D**oS | Login/reset hammering | Throttles above; body-size cap (413); zod rejection before any hashing for malformed payloads; **#10.5** added platform-wide Redis rate limiting at the `defineRoute` chokepoint (per-IP login w/ exponential backoff, per-username login, stricter password-family, global per-session ceiling) | Closed by #10.5 — the "global rate limiting still open" note no longer applies |
| DoS | Lockout as harassment (locking a victim's username) | **Live vector, accepted.** #10.5 re-keyed account lockout to the username ALONE (was `username\|ip` before #10.5) — required to express "10 consecutive failures for one account" and a single-action admin unlock. Anyone who knows a username can therefore lock it for `LOGIN_LOCKOUT_WINDOW_MINUTES` (15). Bounded by: the per-IP backoff limiter (which is only meaningful because the proxy overwrites XFF — see [throttle keying](#throttle-keying)), the 5/60s per-username limiter slowing each attempt run, and admin early-unlock (`identity.account-unlock`, audited) | A distributed attacker can still hold a targeted account — or, with enough sources, many accounts — locked. Monitor `identity.login-failed` / `identity.login-locked` audit bursts. Per-role or IP-reputation exemptions are NOT implemented |
| **E**oP | Bypassing the scope-check | Structural: route files import only the composition root; all record access in handlers flows through `checkScope`; the checker is pure/injected so it cannot be shadowed per-route; matrix changes require security-team review (CODEOWNERS) | #3+ must uphold the same call-site discipline — add lint heuristic then |
| EoP | Bootstrap abuse | `create-admin` refuses when any admin exists; password via env not argv; runs only with direct DB+Redis access (already game over if attacker has that) | — |
| EoP | Weak human-core implementation | Conformance suites (hashing salts/verify, token tamper/expiry, 60+ matrix cases) + mandatory human comprehension review | The suites can't prove crypto parameter quality — that's exactly why the core is human-owned |

## <a id="throttle-keying"></a>Throttle keying trust caveat

`x-forwarded-for` is attacker-controlled unless a trusted reverse proxy
overwrites it. Both `clientIp` helpers (`packages/platform/src/http/define-route.ts`,
`packages/modules/identity/src/api/handlers.ts`) read the **first** hop, so
everything IP-keyed — the per-IP login limiter and its exponential backoff, the
per-IP password-family limiter, and the IP recorded in the auth audit trail —
is only as trustworthy as that overwrite.

The shipped stack satisfies this, but by **default rather than by declaration**,
which is worth knowing before anyone edits either file:
- `Caddyfile` configures **no `trusted_proxies`**. Caddy therefore treats the
  immediate peer as untrusted and *replaces* X-Forwarded-For with the real
  remote address instead of appending to a client-supplied one. Verified on
  `caddy:2-alpine` v2.11.4: a request sending `X-Forwarded-For: 1.2.3.4`
  arrives upstream carrying only the true client IP. (Adding
  `trusted_proxies 0.0.0.0/0` to the same block makes it arrive as
  `1.2.3.4, <real ip>` — forged hop first.)
- `docker-compose.prod.yml` `!reset`s the web service's published ports, so
  Caddy is the only ingress.

**Both halves are load-bearing, and neither is enforced by a test.** Declaring
`trusted_proxies`, or publishing the app port past the proxy, silently reduces
every per-IP control to a no-op — an attacker gets a fresh limiter bucket per
forged header value. Note this is a *behavioural default of a third-party
component*: it changed in Caddy 2.7 (older Caddy, and nginx/HAProxy in their
usual configurations, do append) and could change again on a major upgrade.
Re-check it when bumping the Caddy image.

Two deployment shapes fall outside the guarantee, neither guarded in code:
- **Direct-exposed (no proxy)** — e.g. a bare `next start`, which is how the
  e2e suite runs. This does *not* degrade to a shared "direct" bucket: any
  client that sends its own XFF gets attacker-chosen buckets, which is a
  genuine bypass of the per-IP limiter, strictly worse than a shared bucket.
  The e2e harness relies on exactly this to isolate its login buckets
  (`tests/e2e/support/fixtures.ts`). Unsupported for real installs — run the
  Caddy overlay.
- **Behind a second institution proxy.** Caddy would replace the institution
  proxy's XFF and collapse every client into that proxy's IP. That needs a
  `trusted_proxies` allowlist for the upstream hop *and* a matching change to
  `clientIp` so it reads the correct hop — do not do one without the other.

Account **lockout** is deliberately *not* IP-keyed (see the harassment row
above) and so is unaffected by all of this.

## Explicitly deferred

LDAP/SSO provider security review (arrives with the provider), double-submit
CSRF tokens (with the first browser UI), MFA (policy decision for the
institution, seam exists in the login flow), org-identifier verification
(#3's OrgDirectory).
