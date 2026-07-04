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
| **D**oS | Login/reset hammering | Throttles above; body-size cap (413); zod rejection before any hashing for malformed payloads | Global rate limiting (beyond auth endpoints) still open — ASVS table |
| DoS | Lockout as harassment (locking a victim's username) | Lockout keys include IP, so an attacker locks only their own vantage point per window | Distributed attackers can still degrade a targeted user; monitor `identity.login-failed` audit bursts |
| **E**oP | Bypassing the scope-check | Structural: route files import only the composition root; all record access in handlers flows through `checkScope`; the checker is pure/injected so it cannot be shadowed per-route; matrix changes require security-team review (CODEOWNERS) | #3+ must uphold the same call-site discipline — add lint heuristic then |
| EoP | Bootstrap abuse | `create-admin` refuses when any admin exists; password via env not argv; runs only with direct DB+Redis access (already game over if attacker has that) | — |
| EoP | Weak human-core implementation | Conformance suites (hashing salts/verify, token tamper/expiry, 60+ matrix cases) + mandatory human comprehension review | The suites can't prove crypto parameter quality — that's exactly why the core is human-owned |

## <a id="throttle-keying"></a>Throttle keying trust caveat

`x-forwarded-for` is attacker-controlled unless a trusted reverse proxy
overwrites it. On-prem deployment MUST terminate at the institution proxy
that sets XFF (runbook). Direct-exposed deployments degrade to a shared
"direct" bucket — throttling still works, with coarser collateral.

## Explicitly deferred

LDAP/SSO provider security review (arrives with the provider), double-submit
CSRF tokens (with the first browser UI), MFA (policy decision for the
institution, seam exists in the login flow), org-identifier verification
(#3's OrgDirectory).
