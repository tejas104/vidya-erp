# Assignment #10.5 Security Hardening — Verification Evidence

Branch `feat/a10-remainder-a105-security`. This is the controller's verification bundle for
#10.5 Parts 1–4; the authoritative posture description is `SECURITY.md` (its evidence
placeholders are now filled from this same run). Track B commits: `e2a9f2f` rate limiting ·
`14b6b62` lockout + audit trail · `9779ff8` HTTP hardening · `5b6afaf` composition-root
logger wiring · `7670495` SECURITY.md + guards. Verification-session fix: `412302c`
(admin-unlock HTTP route — see §5).

## 1. e2e security guards (Part 4) — a–d all green

From the full suite (`PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e`,
`tests/e2e/security.spec.ts`):
```
  ✓ (a) 11 rapid failed logins trip the RATE LIMITER, not the account lockout   (652ms)
  ✓ (b) a locked account rejects the correct password until admin unlock        (2.1m)
  ✓ (c) hardening headers present on a sampled page and an API response         (20ms)
  ✓ (d) an oversized request body is rejected (413) before any handler          (28ms)
  26 passed (2.5m)
```
Guard (a) proves the **two mechanisms are distinct**: 11 rapid failures on one username
trip the stricter 5/60s per-username *rate limiter* (RFC 9457 `problem+json`, title "Too
many requests") around attempt 6 — never the 10-consecutive *account lockout*. Guard (b)
reaches genuine lockout by spacing two batches of 5 across the limiter's real 60s window
(hence ~2 min), then shows the **correct** password refused while locked and admin unlock
restoring access. Guards use dedicated throwaway usernames + synthetic XFF so they never
poison the regression specs.

## 2. HTTP hardening headers (Part 3) — page and API

`curl -sI` against the running prod `next start` (full output in `SECURITY.md §Evidence`):
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; ... ; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```
Present identically on `/login` (page) **and** `/api/v1/system/health` (API) — set once in
`next.config.ts` for `source: "/:path*"`. **No `Server` header** on either. Verbose server
headers / stack traces / directory listing: none observed. `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy` pre-existed at `f36956a`; this branch added CSP
(report-only, §6) and HSTS (prod overlay only).

## 3. Redis lockout-key TTL demonstration (Part 4)

A throwaway account driven to genuine lockout (rate-limiter keys cleared between attempts
so all 10 failures reach the lockout counter). Full output in `SECURITY.md §Evidence`:
```
attempt 10 -> HTTP 429            # 10th consecutive failure locks
key: idn:throttle:login:evtest-lockout-1785839137
TTL now: 892   TTL after 3s: 888  # counting down from ~900 (15 min), Redis auto-expiry, no sweep job
correct-password login while locked: 429
unlock: 200   TTL after unlock: -2  # admin early-unlock DELETEs the key
```
Confirms: TTL auto-expiry, the "correct password still refused while locked" B2 behaviour,
and that admin unlock clears the key (not just waits it out).

## 4. Rate limiter — measured session-ceiling margin (Part 1)

The global per-session ceiling was raised from the plan's suggested ~100 to **300 req/60s**
(`RATE_LIMIT_SESSION_MAX`, commit `e2a9f2f`) after measuring the app's own burstiest
legitimate flows: the CSV-import-preview poll (~61 req/min worst case) and the
report-generation poll (~87 req/min). 300 leaves ~3.4–4.9× headroom; 100 would have left
as little as ~1.15×. The full e2e suite ran green with the limiter active — the only
collision was the *test harness* logging in many times from one IP (a harness artifact,
fixed by per-context XFF isolation in `fixtures.ts`; see `a10-evidence.md §2`), not a
legitimate product flow tripping the ceiling.

## 5. Admin-unlock HTTP route — added during verification (`412302c`)

`route-coverage.spec.ts` (a pre-existing regression test) caught that `identity.account-unlock`
(`POST /api/v1/identity/users/{userId}/unlock`) had a registered RouteSpec + handler
(`handlers.ts:517`) but **no Next `route.ts`** — so the endpoint SECURITY.md documents
404'd over HTTP, and e2e guard (b)'s unlock step could not run. Fixed by adding the thin
route file (`export const POST = routeHandler("identity.account-unlock")`, mirroring the
sibling `password/route.ts`). Post-fix: `route-coverage` reports **143 RouteSpecs, 0
missing files, 0 → 404**, and guard (b) exercises the live unlock (200). This is HTTP
wiring under `apps/web/app/api/**`, **not** a change to any handler/core implementation.

## 6. CSP is report-only, not enforced (known limitation, deliberate)

`Content-Security-Policy-Report-Only` ships; the enforcing header is intentionally absent
(e2e guard (c) asserts both facts). Two un-nonced inline scripts in
`apps/web/app/layout.tsx` block enforcement: the pre-existing theme-flash guard **and A2's
own PWA service-worker registration `swScript`**. To enforce: move `swScript` to a static
`/sw-register.js` and nonce/hash the theme script. Carried to the whole-branch review.

## 7. Hard boundary — HELD (identity `core/` untouched)

```
git diff --stat f36956a..HEAD -- packages/modules/identity/src/core/   → (empty)
```
`PasswordHasher` / `SessionManager` / `ScopeChecker` implementations were not modified
across B1–B4. Timing uniformity relies on `PasswordHasher.dummyHash` (pre-existing,
consumed at `auth-service.ts:93`) — evidenced by unit test, not rebuilt. **No STOP
conditions were hit** inside `core/`; the only backend files this branch changed are the
identity `handlers.ts`/`.test.ts` (B2, where backend changes are required) and the new
`unlock/route.ts` (HTTP wiring).

## 8. Deferred (by explicit scope, per SECURITY.md §Deferred)

TOTP 2FA for admins · per-role session policies · IP allowlisting for admin routes ·
enforcing CSP · black-box audit-log read path · account+IP lockout keying. Recorded in
SECURITY.md so "what about security?" has an honest, specific answer.

## 9. Environment notes

Same run as `a10-evidence.md §8`: prod build (rebuilt once to compile the unlock route),
compose stack healthy, worker running, `.env` sourced before `next start`. Unit suite at
HEAD: 698 passing (includes B1's 15 limiter + 7 define-route + 2 env, B2's 17 lockout/audit
tests); typecheck + `check:styles` clean after the verification fixes.
