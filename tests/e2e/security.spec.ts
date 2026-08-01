import { expect, test } from "@playwright/test";
import { apiSession, discover } from "./support/fixtures";

/**
 * Assignment #10.5 Part 4 — security hardening guards.
 *
 * Two DIFFERENT mechanisms both police login abuse and BOTH answer with
 * HTTP 429 — every assertion below distinguishes them by response SHAPE,
 * never by status code alone:
 *
 *  - RATE LIMITER (packages/platform/src/ratelimit, wired in
 *    packages/platform/src/http/define-route.ts) counts every login
 *    REQUEST — successful or not — per source IP and per username.
 *    Defaults (packages/platform/src/config/env.ts): login-IP 10/60s (then
 *    exponential backoff), login-username 5/60s. Its 429 is RFC 9457
 *    problem+json: content-type "application/problem+json", body
 *    {type, title: "Too many requests", status, requestId}. It runs
 *    INSIDE defineRoute, BEFORE the identity module's handler is ever
 *    called (packages/platform/src/http/define-route.ts — the identifier
 *    check happens after body parsing but before `handler(...)`).
 *
 *  - ACCOUNT LOCKOUT (packages/modules/identity/src/service/throttle.ts +
 *    auth-service.ts) counts CONSECUTIVE CREDENTIAL FAILURES per account
 *    (username) alone, entirely inside AuthService.login — a request only
 *    ever reaches this counter if the rate limiter let it through to the
 *    handler. Default: 10 consecutive failures locks the account 15
 *    minutes (LOGIN_LOCKOUT_MAX_ATTEMPTS / _WINDOW_MINUTES). Its 429 is
 *    plain json: {message: "too many failed attempts; account locked, try
 *    again later"}, retry-after is always exactly "900" — a fixed config
 *    value (loginLockoutWindowMinutes * 60 in handlers.ts), never a Redis
 *    TTL like the limiter's variable retry-after.
 *
 * Because the username limiter (5/60s) is STRICTER than the lockout
 * threshold (10 consecutive), 11 rapid failed logins on one account trip
 * the limiter around the 6th request — lockout is never reached that way.
 * Guard (a) below asserts exactly that (and that no response carries the
 * lockout shape). Guard (b) reaches genuine lockout deliberately, by
 * spacing two batches of 5 across the limiter's 60-second window.
 *
 * ISOLATION (no shared account, no poisoning other specs): every test
 * below uses (1) a per-test username that is never reused elsewhere in
 * the suite, so it never touches a demo-* account, and (2) a synthetic
 * X-Forwarded-For value unique to that test. Both the limiter and the
 * lockout throttle key off username/IP alone (clientIp() in
 * define-route.ts and handlers.ts both trust the first XFF hop), so this
 * fully isolates this file's deliberate failed-login floods from every
 * other spec's logins — which all share the fallback "direct" IP bucket
 * and the demo-* usernames (tests/e2e/support/fixtures.ts CREDS). This
 * holds regardless of run order: playwright.config.ts runs the whole
 * project at workers:1 / fullyParallel:false, so nothing here executes
 * concurrently with role-journeys.spec.ts, but isolating by key means it
 * would still be safe even if that ever changed.
 *
 * AUDIT ROWS: the assignment asks that (a) confirm "correct audit rows
 * exist". There is no HTTP surface to read sys_audit_log — the system
 * module (packages/modules/system/src/definition.ts) exposes only
 * health/ready/metrics, and the read functions that exist
 * (readRecentAuditEvents / readAuditEventsByAction / readAuditEventsForResource,
 * packages/modules/system/src/service/audit-writer.ts) take a Db handle
 * directly; they have no route and are only reachable from the
 * integration suite (tests/integration/audit-log.int.test.ts), which has
 * real Postgres access this e2e harness deliberately does not. Per this
 * task's own instruction, that DB is not queried from here and no
 * endpoint is invented. Guard (a) instead asserts the strongest proxy
 * observable over HTTP: exactly the requests that reach AuthService.login
 * (and would therefore call loginThrottle.recordFailure + audit
 * identity.login-failed — auth-service.ts fail()) return 401, and every
 * later one is deflected by the limiter pre-handler (so it could not have
 * written a row). The row CONTENT itself (action name, ip/userAgent
 * detail, locked flag) is asserted at the unit level today —
 * auth-service.test.ts "rejects a wrong password uniformly and audits the
 * failure" / "burns a dummy verification for unknown users" — and the
 * table's durability (append-only, actor_type CHECK) is integration-tested
 * in audit-log.int.test.ts. That is a real gap for anyone who wants
 * black-box e2e proof of row content; flagged, not silently worked around.
 */

test.describe("10.5 Part 4 — security hardening guards", () => {
  test("(a) 11 rapid failed logins trip the RATE LIMITER, not the account lockout", async ({
    request,
  }) => {
    const username = `sec-a-${Date.now()}`; // never a real account — every attempt is invalid-credentials
    const xff = "10.99.10.1"; // synthetic, dedicated to this test only

    const attempts: { status: number; contentType: string | undefined; body: Record<string, unknown> }[] =
      [];
    for (let i = 0; i < 11; i++) {
      const res = await request.post("/api/v1/identity/auth/login", {
        headers: { "x-forwarded-for": xff },
        data: { username, password: "wrong-password-not-real" },
      });
      attempts.push({
        status: res.status(),
        contentType: res.headers()["content-type"],
        body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
      });
    }

    // Attempts 1-5: under the per-username limiter's cap (5/60s), so each
    // one reaches AuthService.login. The account doesn't exist, so the
    // uniform outcome is 401 invalid-credentials — the audited branch.
    for (const [i, attempt] of attempts.slice(0, 5).entries()) {
      expect(attempt.status, `attempt ${i + 1} reaches the service`).toBe(401);
    }

    // Attempts 6-11: the per-username limiter (and, by #11, the per-IP
    // backoff limiter too — both counters are dedicated to this test's
    // username/IP) reject BEFORE the handler runs. Assert the LIMITER
    // shape specifically, not merely "429".
    const limited = attempts.slice(5);
    for (const [i, attempt] of limited.entries()) {
      expect(attempt.status, `attempt ${i + 6} is limiter-rejected`).toBe(429);
      expect(attempt.contentType, `attempt ${i + 6} content-type`).toContain(
        "application/problem+json",
      );
      expect(attempt.body.title, `attempt ${i + 6} body`).toBe("Too many requests");
    }

    // None of the 11 carry the LOCKOUT shape: proves the 10-consecutive-
    // failure threshold was never reached by this rapid burst, because the
    // stricter 5/60s limiter fired first (see file-level doc comment).
    for (const attempt of attempts) {
      expect(attempt.body.message).not.toBe(
        "too many failed attempts; account locked, try again later",
      );
    }
  });

  test("(b) a locked account rejects the correct password until admin unlock", async ({
    baseURL,
    request,
  }) => {
    // Two real 60s waits so the per-username RATE LIMITER window lapses
    // between batches — see the file-level doc comment for why this is
    // the only way to reach genuine lockout (10 consecutive failures
    // reaching AuthService.login) without the limiter intercepting first.
    test.setTimeout(240_000);

    const admin = await apiSession(baseURL!, "admin");
    const ids = await discover(admin);

    // Dedicated throwaway account — never a seeded/shared one, so locking
    // it cannot break any other test in the run.
    const username = `sec-b-lockout-${Date.now()}`;
    const correctPassword = "Sec-B-Correct-Pass-2026!";
    const created = await admin.post("/api/v1/identity/users", {
      data: {
        username,
        displayName: "10.5 Part 4 lockout throwaway",
        collegeId: ids.collegeId,
        temporaryPassword: "Sec-B-Temp-Pass-2026!x",
        roles: [],
      },
    });
    expect(created.status(), "create throwaway account").toBe(201);
    const { id: userId } = (await created.json()) as { id: string };

    // Admin sets a known password directly (status -> active), so the
    // "correct password" check below isn't tangled up with must_reset.
    const setPw = await admin.post(`/api/v1/identity/users/${encodeURIComponent(userId)}/password`, {
      data: { newPassword: correctPassword },
    });
    expect(setPw.status(), "admin sets a known password").toBe(200);

    const xff = "10.99.10.2"; // synthetic, dedicated to this test only
    const wrongLogin = () =>
      request.post("/api/v1/identity/auth/login", {
        headers: { "x-forwarded-for": xff },
        data: { username, password: "definitely-still-wrong" },
      });

    // Batch 1: 5 wrong-password attempts, exactly at the per-username
    // limiter's cap — each one reaches AuthService.login and increments
    // the real lockout counter (failures 1-5, not yet locked).
    for (let i = 0; i < 5; i++) {
      const res = await wrongLogin();
      expect(res.status(), `batch 1 attempt ${i + 1}`).toBe(401);
    }

    // Let the limiter's 60s window fully lapse (both the username and the
    // IP counters use the same window length) before batch 2.
    await new Promise((resolve) => setTimeout(resolve, 62_000));

    // Batch 2: 5 more wrong-password attempts (failures 6-10). The 10th
    // cumulative consecutive failure crosses LOGIN_LOCKOUT_MAX_ATTEMPTS
    // (10) — the account locks on this very response.
    let tenthResponse;
    for (let i = 0; i < 5; i++) {
      tenthResponse = await wrongLogin();
    }
    expect(tenthResponse!.status(), "10th consecutive failure locks the account").toBe(429);
    const tenthBody = (await tenthResponse!.json()) as { message: string };
    expect(tenthBody.message).toBe("too many failed attempts; account locked, try again later");
    // Fixed config value, not a Redis TTL — distinguishes this from the
    // limiter's variable retry-after (see file-level doc comment).
    expect(tenthResponse!.headers()["retry-after"]).toBe("900");

    // Another full window, so the NEXT request reaches AuthService.login
    // (past the limiter) rather than being deflected by it — otherwise a
    // 429 here would prove nothing about the lockout specifically.
    await new Promise((resolve) => setTimeout(resolve, 62_000));

    // The defining #10.5 B2 behaviour: the CORRECT password, while
    // locked, is still refused. AuthService.login checks `alreadyLocked`
    // and returns "locked" regardless of credentialOk (auth-service.ts) —
    // the timing-safe verify still ran, but the lock wins.
    const stillLocked = await request.post("/api/v1/identity/auth/login", {
      headers: { "x-forwarded-for": xff },
      data: { username, password: correctPassword },
    });
    expect(stillLocked.status(), "correct password refused while locked").toBe(429);
    const stillLockedBody = (await stillLocked.json()) as { message: string };
    expect(stillLockedBody.message).toBe("too many failed attempts; account locked, try again later");

    // Admin early-unlock clears the counter without waiting out the
    // 15-minute window (identity.account-unlock).
    const unlock = await admin.post(`/api/v1/identity/users/${encodeURIComponent(userId)}/unlock`);
    expect(unlock.status(), "admin unlock").toBe(200);

    const afterUnlock = await request.post("/api/v1/identity/auth/login", {
      headers: { "x-forwarded-for": xff },
      data: { username, password: correctPassword },
    });
    expect(afterUnlock.status(), "correct password now succeeds").toBe(200);

    // Hygiene: don't leave a known-password throwaway account active in
    // the shared demo DB after the test.
    await admin.patch(`/api/v1/identity/users/${encodeURIComponent(userId)}`, {
      data: { status: "disabled" },
    });

    await admin.dispose();
  });

  test("(c) hardening headers present on a sampled page and an API response (Next layer, local run)", async ({
    request,
  }) => {
    // Both /login (a page) and /api/v1/system/health (a public API route)
    // are matched by next.config.ts headers()'s source: "/:path*" — in
    // THIS codebase, unlike a naive split-by-layer assumption, ALL of
    // nosniff / X-Frame-Options / Referrer-Policy / CSP-Report-Only are
    // set at the Next layer for every route including API routes; the
    // Caddyfile deliberately does NOT duplicate them (see its own
    // comment) and adds only Strict-Transport-Security (opt-in via
    // HSTS_DIRECTIVE, off by default even in docker-compose.prod.yml's
    // default self-signed TLS mode) and stripping the Server header —
    // neither assertable nor meaningfully present in a local `next start`
    // run, so this guard does not attempt them.
    const page = await request.get("/login");
    const api = await request.get("/api/v1/system/health");

    for (const [label, res] of [
      ["page GET /login", page],
      ["api GET /api/v1/system/health", api],
    ] as const) {
      const headers = res.headers();
      expect(headers["x-content-type-options"], label).toBe("nosniff");
      expect(headers["x-frame-options"], label).toBe("DENY");
      expect(headers["referrer-policy"], label).toBe("no-referrer");

      // CSP ships REPORT-ONLY, not enforced (#10.5 Part 3): two un-nonced
      // inline <script> tags in apps/web/app/layout.tsx (theme-flash
      // prevention, SW registration) would violate an enforced
      // script-src 'self'. Assert the Report-Only header — asserting the
      // enforcing Content-Security-Policy header would fail for a reason
      // that isn't a defect; it doesn't exist yet by design.
      expect(headers["content-security-policy-report-only"], label).toContain("script-src 'self'");
      expect(headers["content-security-policy"], `${label} must not be enforcing yet`).toBeUndefined();
    }
  });

  test("(d) an oversized request body is rejected (413) before it reaches any handler", async ({
    request,
  }) => {
    // identity.login is public and declares no per-route bodyMaxBytes
    // override, so it exercises the GLOBAL default cap
    // (HttpGuardOptions.bodyMaxBytes / env BODY_MAX_BYTES, 1_048_576 bytes
    // — packages/platform/src/http/define-route.ts DEFAULT_HTTP_GUARDS).
    // That check runs before JSON.parse and before zod validation
    // (define-route.ts), so an oversized body is rejected regardless of
    // its shape or the route's own auth/rate-limit posture. (The larger
    // UPLOAD_BODY_MAX_BYTES override on people.document-upload /
    // people.imports / coursework upload routes is a distinct, higher
    // ceiling for a distinct reason — base64 file payloads — and isn't
    // re-tested here; the mechanism being asserted is the same size-check
    // code path, exercised at its default configuration.)
    const oversizedPassword = "x".repeat(2 * 1024 * 1024); // 2 MiB > 1 MiB default cap
    const res = await request.post("/api/v1/identity/auth/login", {
      headers: { "x-forwarded-for": "10.99.10.3" }, // synthetic, dedicated to this test only
      data: { username: "sec-d-oversized-body", password: oversizedPassword },
    });
    expect(res.status()).toBe(413);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("Request body too large");
  });
});
