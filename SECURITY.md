# Security posture — Vidya ERP

Snapshot as of `#10.5 Part 4` (branch `feat/a10-remainder-a105-security`), so
that "what about security?" has an honest, specific answer instead of a
guess. This is a snapshot, not a policy: it describes what the code does
today, points at the file that does it, and says plainly what is not done
yet. Where a claim needs a running system to demonstrate, that spot is
marked as a **PLACEHOLDER** rather than filled with invented output.

## What is enforced today

### Authentication & sessions
- Username/password login, Redis-backed sessions via an `HttpOnly`,
  `SameSite=Strict` cookie (ADR-0011). No token in JS-reachable storage.
- Passwords: Argon2 hashing (human-owned core), NIST 800-63B-style policy —
  length is the primary control, 12–256 characters (`passwordSchema`,
  `packages/modules/identity/src/definition.ts`).
- Uniform failure surface: unknown username, wrong password, and a disabled
  account all return the same 401 with the same timing profile (dummy hash
  verification for unknown users) — `packages/modules/identity/src/service/auth-service.ts`.
- Session absolute TTL and idle timeout, invalidate-all on password
  change/reset/role change.

### Request-volume rate limiting (independent of account lockout)
Redis fixed-window / backoff counters, one shared middleware for every
route (`packages/platform/src/ratelimit/limiter.ts`, wired in
`packages/platform/src/http/define-route.ts`). Counts **every request**,
successful or not — this is an availability/abuse control, not a
credential-security one.

| Scope | Keyed by | Default | Config |
|---|---|---|---|
| Login | source IP | 10 req/60s, then exponential backoff (base 60s, doubling, capped 1800s, penalty memory 3600s) | `RATE_LIMIT_LOGIN_IP_*` |
| Login | username | 5 req/60s | `RATE_LIMIT_LOGIN_USERNAME_*` |
| Password set/change/reset | IP + identifier | 3 req/60s | `RATE_LIMIT_PASSWORD_*` |
| Any authenticated session | session id | 300 req/60s | `RATE_LIMIT_SESSION_*` |

The session ceiling was deliberately raised from the plan's suggested
~100 to 300 after measuring the app's own burstiest legitimate flows: the
CSV-import-preview and report-generation poll loops in `apps/web` have
hard-coded intervals giving worst cases of ~61 and ~87 req/min
respectively (commit `e2a9f2f`); 100 would have left as little as 1.15x
margin, 300 leaves 3–5x.

429 responses from this layer are RFC 9457 `application/problem+json`
(`packages/platform/src/http/problem.ts`): `{type, title: "Too many
requests", status, requestId}`, with a `retry-after` header sized to the
window/backoff remaining.

### Account lockout (independent of the rate limiter above)
`packages/modules/identity/src/service/throttle.ts` +
`auth-service.ts`. Counts **consecutive credential failures**, keyed by
**account (username) alone** — a security control, not a volume control.

- Default: 10 consecutive failures locks the account for 15 minutes
  (`LOGIN_LOCKOUT_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_WINDOW_MINUTES`).
- Redis TTL auto-expiry — no sweep job, and the window is fixed (starts at
  the first failure, not extended by later ones).
- A successful login clears the counter.
- An admin can clear it early: `POST /api/v1/identity/users/{userId}/unlock`
  (`identity.account-unlock`), audited normally (fails the request if the
  audit write fails — the one place this module fails closed on audit).
- Two deliberate behaviours, both there to avoid turning the lock itself
  into an oracle: (1) a locked account still runs the real (or dummy)
  password verification before the lock is consulted, so response timing
  can't distinguish "locked" from "wrong password" from "unknown user";
  (2) an audit-write failure on a *failed* login is logged and swallowed,
  never rethrown — losing that audit row does not turn a 401/429 into a
  500 (deliberately asymmetric with the admin-unlock audit above, which
  *does* fail closed, because bypassing a lockout is the more sensitive
  action of the two).
- 429 body is plain JSON: `{message: "too many failed attempts; account
  locked, try again later"}`, `retry-after` is always exactly the fixed
  `LOGIN_LOCKOUT_WINDOW_MINUTES * 60` (900 at the default) — never a
  variable Redis TTL like the rate limiter's.
- These two mechanisms trip independently and their 429s are shaped
  differently on purpose so a caller (or a test) can tell which one fired.
  Because the per-username rate limit (5/60s) is *stricter* than the
  lockout threshold (10 consecutive), a rapid burst of failed logins hits
  the rate limiter first — the lockout is only reached by attempts spaced
  across the limiter's window. See `tests/e2e/security.spec.ts` guards
  (a) and (b) for the worked-out distinction.

### HTTP hardening headers
Set in **one place**, `apps/web/next.config.ts`'s `headers()`, matching
every route (`source: "/:path*"`) — pages and API responses alike, even in
a plain `next start` run with no reverse proxy in front:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy-Report-Only: ...` (see Known limitations)

`Caddyfile` deliberately does **not** duplicate any of the above (its own
comment explains why: one place to declare them, not two that can drift).
The only things Caddy adds are `Strict-Transport-Security` — opt-in via
`HSTS_DIRECTIVE`, empty/absent by default even in
`docker-compose.prod.yml`'s default self-signed TLS mode, because HSTS is
actively harmful to ship on a throwaway/local-eval install — and stripping
the `Server` header. Neither is reachable or meaningful from a local `next
start` run.

### Request body size limits
`packages/platform/src/http/define-route.ts`, enforced before JSON parsing
or schema validation, so an oversized body never reaches a handler:

- Default cap: 1,048,576 bytes (1 MiB) — `HttpGuardOptions.bodyMaxBytes` /
  `BODY_MAX_BYTES`.
- Per-route override for genuine uploads: 8 MiB
  (`UPLOAD_BODY_MAX_BYTES`), applied to `people.document-upload`,
  `people.imports`, and the two coursework upload routes (materials,
  assignment submission) — sized above the largest real payload in those
  schemas (~7 MB base64) with headroom; the handler separately enforces the
  true 5 MB file-size limit.
- Rejected with `413` (RFC 9457 problem+json, title "Request body too
  large").

### CSRF (state-changing requests)
Two layers (ADR-0011): the session cookie is `SameSite=Strict` (layer 1);
`packages/platform/src/http/define-route.ts` additionally checks the
`Origin` header on any state-changing method against `TRUSTED_ORIGINS`
plus the request's own origin, rejecting a mismatch with 403 (layer 2).

### Audit logging
Every state-changing route must declare an audit action or `defineRoute`
refuses to build (Constitution rule 7) — enforced at composition time, not
just convention. The table (`sys_audit_log`, owned by the `system` module)
is append-only at the database level (UPDATE/DELETE/TRUNCATE all rejected
by a trigger — see `tests/integration/audit-log.int.test.ts`). Login
success/failure/lockout/unlock all audit with actor, IP, and user agent
where relevant (`auth-service.ts`).

**Known gap:** there is no HTTP endpoint to read `sys_audit_log` back. The
read functions that exist (`readRecentAuditEvents`,
`readAuditEventsByAction`, `readAuditEventsForResource` in
`packages/modules/system/src/service/audit-writer.ts`) take a DB handle
directly and are reachable only from the integration test suite. A
black-box (e2e / API-client) caller — including this document's own
evidence gathering below — cannot independently confirm audit row content
without direct database access. If an operational "what got logged"
answer is ever needed by a non-engineer, that's a real product gap, not
just a testing one.

## Config knobs (environment variables)

All parsed and validated in `packages/platform/src/config/env.ts`; an
invalid or missing required value fails startup with a message naming the
variable (never the value, since some are secrets).

| Variable | Default | Purpose |
|---|---|---|
| `BODY_MAX_BYTES` | 1048576 | Global request body cap (bytes) |
| `SESSION_COOKIE_NAME` | `vidya_session` | Session cookie name |
| `SESSION_COOKIE_SECURE` | `true` | `Secure` flag on the session cookie |
| `SESSION_TTL_HOURS` | 12 | Absolute session lifetime |
| `SESSION_IDLE_MINUTES` | 30 | Idle timeout |
| `RESET_TOKEN_TTL_MINUTES` | 30 | Password-reset token lifetime |
| `LOGIN_MAX_ATTEMPTS` | 5 | Reset-token redemption throttle (IP-keyed) attempt cap |
| `LOGIN_WINDOW_MINUTES` | 15 | ...its window |
| `LOGIN_LOCKOUT_MAX_ATTEMPTS` | 10 | Account lockout: consecutive failures before lock |
| `LOGIN_LOCKOUT_WINDOW_MINUTES` | 15 | ...and how long the lock (and the failure-count window) lasts |
| `RATE_LIMIT_LOGIN_IP_MAX` | 10 | Login rate limiter, per-IP cap per window |
| `RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS` | 60 | ...window |
| `RATE_LIMIT_LOGIN_IP_BACKOFF_BASE_SECONDS` | 60 | First backoff block once tripped |
| `RATE_LIMIT_LOGIN_IP_BACKOFF_MAX_SECONDS` | 1800 | Backoff ceiling |
| `RATE_LIMIT_LOGIN_IP_PENALTY_MEMORY_SECONDS` | 3600 | How long repeat offenses are remembered |
| `RATE_LIMIT_LOGIN_USERNAME_MAX` | 5 | Login rate limiter, per-username cap per window |
| `RATE_LIMIT_LOGIN_USERNAME_WINDOW_SECONDS` | 60 | ...window |
| `RATE_LIMIT_PASSWORD_MAX` | 3 | Password set/change/reset limiter cap |
| `RATE_LIMIT_PASSWORD_WINDOW_SECONDS` | 60 | ...window |
| `RATE_LIMIT_SESSION_MAX` | 300 | Per-session request ceiling (see measurement note above) |
| `RATE_LIMIT_SESSION_WINDOW_SECONDS` | 60 | ...window |
| `TRUSTED_ORIGINS` | `""` (empty) | Comma-separated extra allowed Origins for CSRF layer 2 |

## Deferred (not built, by explicit scope decision)

- **TOTP 2FA for admins.** No second factor exists anywhere in the login
  flow today. The login choreography (`AuthService.login`) has no seam for
  an extra challenge step; adding one is a real design task (session
  issuance currently completes atomically on password verification), not
  a config flip.
- **Per-role session policies.** `SESSION_TTL_HOURS` / `SESSION_IDLE_MINUTES`
  are global — every role gets the same absolute/idle timeout. There is no
  mechanism to, for example, give admin sessions a shorter idle window than
  student/teacher sessions.
- **IP allowlisting for admin routes.** Admin-only routes
  (`identity.user-create`, `identity.roles-set`, `identity.account-unlock`,
  etc.) are gated on role (`ADMIN_ONLY` in each module's `definition.ts`)
  only — there is no network-layer or app-layer restriction on *which
  source IPs* may call them beyond the general login rate limiter.

`docs/threat-model-identity.md` separately lists LDAP/SSO provider review,
double-submit CSRF tokens, and MFA as deferred; that document predates the
`#10.5` hardening work (its numbers for lockout keying are stale — it still
describes a per-user+IP scheme; the actual mechanism is per-account only,
see above) and should be reconciled against this file, but that
reconciliation is outside this task's scope.

## Known limitations

1. **CSP ships Report-Only, not enforced.** `apps/web/app/layout.tsx` has
   two inline `<script dangerouslySetInnerHTML>` tags (theme-flash
   prevention, service-worker registration) with no nonce. An enforced
   `script-src 'self'` would block both. Flipping to enforcing
   `Content-Security-Policy` needs either a per-request nonce (Next's
   middleware-based nonce support) or moving both scripts to external
   files under `public/` — deferred; `layout.tsx` was outside this task's
   file ownership. Until then, treat CSP as monitoring-only: it will
   *report* violations (once a report endpoint is wired — also not done)
   but will not *block* anything.
2. **`style-src 'unsafe-inline'` is a permanent-for-now loosening**, not an
   oversight: ~18 components set React inline `style={{...}}`; rewriting
   all of them to CSS Modules/classes was out of scope.
3. **HSTS is off by default everywhere**, including the production compose
   file's default (self-signed `tls internal`) mode. It must be
   deliberately turned on via `HSTS_DIRECTIVE` only once the deployment has
   a real, publicly-trusted certificate — see the comment in
   `docker-compose.prod.yml`.
4. **No black-box audit-log read path** — see "Known gap" under Audit
   logging above.
5. **Lockout is keyed by account only, not account+IP** — a conscious
   trade (`auth-service.ts` doc comment): per-account-only keying enables a
   theoretical "lock the victim out" harassment vector (an attacker who
   doesn't know the password can still lock a legitimate user out), traded
   against being able to satisfy "10 consecutive failures locks the
   account" and a single-action admin unlock. The per-IP backoff limiter
   and admin early-unlock bound the residual risk.
6. **Rate-limit/lockout keying trusts the first `X-Forwarded-For` hop.**
   Correct only behind a reverse proxy that overwrites/sets it (the
   provided `Caddyfile` does). A direct-exposed deployment (no proxy)
   degrades every unheadered caller to a shared "direct" bucket — coarser,
   but still functioning throttling, not a bypass.

## Evidence

The following are captured by the controller running the full e2e suite
(`tests/e2e/security.spec.ts`, guards a–d) plus the Docker compose stack —
not fabricated here.

**e2e run output** (guards a–d, from the full suite — `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e`, prod build + compose stack + worker):
```
  ✓  23 tests\e2e\security.spec.ts:79  (a) 11 rapid failed logins trip the RATE LIMITER, not the account lockout (652ms)
  ✓  24 tests\e2e\security.spec.ts:129 (b) a locked account rejects the correct password until admin unlock (2.1m)
  ✓  25 tests\e2e\security.spec.ts:235 (c) hardening headers present on a sampled page and an API response (Next layer, local run) (20ms)
  ✓  26 tests\e2e\security.spec.ts:272 (d) an oversized request body is rejected (413) before it reaches any handler (28ms)

  26 passed (2.5m)
```
(All four security guards pass, alongside the 18 pre-existing regression journeys
and the 4 assignment-#10 fast-path journeys. Guard (b) takes ~2 min because it
spaces two batches of failed logins across the limiter's real 60s window to reach
genuine lockout — see the doc comment in `tests/e2e/security.spec.ts`.)

**header sample, page** (`curl -sI http://localhost:3001/login` against the
running prod `next start`; non-security lines omitted):
```
HTTP/1.1 200 OK
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Content-Type: text/html; charset=utf-8
```

**header sample, API** (`curl -sI http://localhost:3001/api/v1/system/health`;
non-security lines omitted). Same four headers as the page — they are set for
`source: "/:path*"`, API routes included; and there is **no `Server` header**
(next start emits none, and the prod Caddyfile strips it):
```
HTTP/1.1 200 OK
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
content-type: application/json
x-request-id: b4e888ed-1e44-4162-8996-35f8b6f725ab
```

**Redis lockout-key TTL demonstration** — a throwaway account driven to genuine
lockout (10 consecutive credential failures reaching `AuthService.login`; the
rate-limiter keys were cleared between attempts so every failure reached the
lockout counter rather than being deflected by the 5/60s limiter). Shows the
`idn:throttle:login:<account>` key's TTL counting down from ~900s, the correct
password refused while locked, and admin unlock deleting the key (`TTL -2`):
```
### 3. 10 consecutive wrong-password logins
  attempt 1  -> HTTP 401
  ...
  attempt 9  -> HTTP 401
  attempt 10 -> HTTP 429      # 10th failure locks the account
### 4. the lockout key and its TTL (starts near 900 = 15 min, counting down)
  key: idn:throttle:login:evtest-lockout-1785839137
  TTL now:      892
  TTL after 3s: 888
### 5. correct password is refused while locked
  correct-password login while locked: 429 (expect 429)
### 6. admin early-unlock deletes the key
  unlock: 200
  TTL after unlock: -2   (-2 = key does not exist)
```
(`retry-after` on the lockout 429 is the fixed `LOGIN_LOCKOUT_WINDOW_MINUTES*60`
= 900, distinct from the rate limiter's variable window-derived `retry-after`.)

**Lighthouse PWA installability** (`lighthouse@11.7.1 http://localhost:3001/login
--only-categories=pwa`, headless Chrome; full report at
`docs/assignment-10/a10-lighthouse-pwa.report.html`). PWA category **1.0 / 100%**:
```
installable-manifest  PASS   manifest + service worker meet installability requirements
maskable-icon         PASS   manifest has a maskable icon
splash-screen         PASS   configured for a custom splash screen
themed-omnibox        PASS   sets a theme color for the address bar
viewport / content-width  PASS
```
(Lighthouse removed the PWA category in v12, so v11.7.1 was pinned to produce a
categorised installability report; the underlying signals are also asserted
black-box by e2e guard A4 in `tests/e2e/fast-path.spec.ts`.)
