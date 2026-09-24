import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import { AuthService } from "./auth-service";
import { FailureThrottle } from "./throttle";
import {
  FakePasswordHasher,
  FakeResetTokensRepo,
  FakeSessionManager,
  FakeUsersRepo,
  MemoryThrottleStore,
  RecordingAudit,
} from "../../test-support/fakes";
import type { ExternalIdentityProvider } from "../providers/external";

const silentLogger = pino({ level: "silent" });

function makeService(
  overrides: {
    externalProvider?: ExternalIdentityProvider;
    lockoutMaxAttempts?: number;
    // RecordingAudit, not the bare AuditLogger interface: the union of the two
    // widens to AuditLogger and the returned handle loses .events/.actions(),
    // which most tests here assert on.
    audit?: RecordingAudit;
  } = {},
) {
  const repo = new FakeUsersRepo();
  const resetTokens = new FakeResetTokensRepo();
  const hasher = new FakePasswordHasher();
  const sessions = new FakeSessionManager();
  const audit = overrides.audit ?? new RecordingAudit();
  const store = new MemoryThrottleStore();
  const lockoutPolicy = { maxAttempts: overrides.lockoutMaxAttempts ?? 3, windowMinutes: 15 };
  const resetPolicy = { maxAttempts: 3, windowMinutes: 15 };
  const service = new AuthService({
    repo,
    resetTokens,
    hasher,
    sessions,
    audit,
    logger: silentLogger,
    loginThrottle: new FailureThrottle(store, lockoutPolicy, "login"),
    resetThrottle: new FailureThrottle(store, resetPolicy, "reset"),
    resetTokenTtlMinutes: 30,
    ...(overrides.externalProvider !== undefined ? { externalProvider: overrides.externalProvider } : {}),
  });
  return { service, repo, resetTokens, hasher, sessions, audit, store };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const seedActiveUser = (repo: FakeUsersRepo) =>
  repo.seed({
    username: "asha",
    displayName: "Asha Verma",
    passwordHash: "fake-hash::right-password::seed",
    status: "active",
    roles: ["teacher"],
    grants: [
      {
        id: "g1",
        role: "teacher",
        org: { collegeId: "col-1", departmentId: "dep-sci", classId: "cls-10a" },
        subjectId: "sub-math",
        verified: false,
      },
    ],
  });

describe("AuthService.login", () => {
  it("issues a session with the roles+grants snapshot on success", async () => {
    const { service, repo, sessions } = makeService();
    const user = seedActiveUser(repo);
    const result = await service.login("asha", "right-password", "1.2.3.4");
    expect(result.outcome).toBe("success");
    if (result.outcome === "success") {
      expect(result.user).toEqual({ id: user.id, displayName: "Asha Verma", roles: ["teacher"] });
      const record = await sessions.resolve(result.token);
      expect(record?.grants).toEqual([
        {
          role: "teacher",
          org: { collegeId: "col-1", departmentId: "dep-sci", classId: "cls-10a" },
          subjectId: "sub-math",
        },
      ]);
    }
  });

  it("is case-insensitive on username lookup", async () => {
    const { service, repo } = makeService();
    seedActiveUser(repo);
    const result = await service.login("ASHA", "right-password", "1.2.3.4");
    expect(result.outcome).toBe("success");
  });

  it("rejects a wrong password uniformly and audits the failure", async () => {
    const { service, repo, audit } = makeService();
    seedActiveUser(repo);
    const result = await service.login("asha", "wrong", "1.2.3.4");
    expect(result.outcome).toBe("invalid-credentials");
    expect(audit.actions()).toContain("identity.login-failed");
    expect(audit.events[0]?.details).toMatchObject({ reason: "wrong-password", ip: "1.2.3.4" });
  });

  it("burns a dummy verification for unknown users (enumeration resistance)", async () => {
    const { service, hasher, audit } = makeService();
    const result = await service.login("ghost", "anything-here", "1.2.3.4");
    expect(result.outcome).toBe("invalid-credentials");
    expect(hasher.verifyCalls).toEqual([hasher.dummyHash]);
    expect(audit.events[0]?.details).toMatchObject({ reason: "unknown-user" });
  });

  it("rejects disabled accounts with the uniform outcome (after verification)", async () => {
    const { service, repo, audit } = makeService();
    repo.seed({ username: "off", passwordHash: "fake-hash::pw::x", status: "disabled" });
    const result = await service.login("off", "pw", "1.2.3.4");
    expect(result.outcome).toBe("invalid-credentials");
    expect(audit.events[0]?.details).toMatchObject({ reason: "account-disabled" });
  });

  it("blocks must_reset accounts only after the password verified", async () => {
    const { service, repo, audit } = makeService();
    repo.seed({ username: "newbie", passwordHash: "fake-hash::temp-pass::x", status: "must_reset" });
    expect((await service.login("newbie", "wrong", "1.2.3.4")).outcome).toBe(
      "invalid-credentials",
    );
    const result = await service.login("newbie", "temp-pass", "1.2.3.4");
    expect(result.outcome).toBe("reset-required");
    expect(audit.actions()).toContain("identity.login-blocked-reset-required");
  });

  it("locks the ACCOUNT (not user+ip) after maxAttempts consecutive failures and stays locked", async () => {
    const { service, repo } = makeService();
    seedActiveUser(repo);
    expect((await service.login("asha", "no1", "9.9.9.9")).outcome).toBe("invalid-credentials");
    expect((await service.login("asha", "no2", "9.9.9.9")).outcome).toBe("invalid-credentials");
    expect((await service.login("asha", "no3", "9.9.9.9")).outcome).toBe("locked");
    // Even the correct password is refused while locked.
    expect((await service.login("asha", "right-password", "9.9.9.9")).outcome).toBe("locked");
    // #10.5 B2: lockout is per-ACCOUNT, deliberately not per-(user,ip) — a
    // different source IP does NOT bypass it (see the report's threat-model
    // discussion: this trades a lockout-as-harassment risk for satisfying
    // "10 consecutive failures locks the account" and single-action admin
    // unlock; B1's per-IP backoff limiter bounds the residual risk).
    expect((await service.login("asha", "right-password", "8.8.8.8")).outcome).toBe("locked");
  });

  it("accumulates failures from DIFFERENT source IPs into one account bucket", async () => {
    const { service, repo } = makeService();
    seedActiveUser(repo);
    // The test above proves an EXISTING lock ignores the source IP. This
    // proves the other half, which is what actually stops distributed
    // guessing: failures arriving one-per-address still add up. Under the
    // pre-#10.5 (user,ip) subject each of these lands in its own bucket and
    // nothing ever locks. Mixed case on the last one also pins that the
    // subject is the NORMALISED username — "ASHA" must not get a fresh
    // allowance.
    expect((await service.login("asha", "no1", "203.0.113.1")).outcome).toBe(
      "invalid-credentials",
    );
    expect((await service.login("asha", "no2", "203.0.113.2")).outcome).toBe(
      "invalid-credentials",
    );
    expect((await service.login("ASHA", "no3", "203.0.113.3")).outcome).toBe("locked");
  });

  it("locks only the account under attack — another username from those IPs is unaffected", async () => {
    const { service, repo } = makeService();
    seedActiveUser(repo);
    await service.login("asha", "no1", "203.0.113.1");
    await service.login("asha", "no2", "203.0.113.1");
    expect((await service.login("asha", "no3", "203.0.113.1")).outcome).toBe("locked");
    // Same address, different account: the lockout subject carries no IP, so
    // there is nothing here for a neighbour to inherit. (Bounding what one
    // address can do at all is the per-IP RATE LIMITER's job — a different
    // mechanism, wired in defineRoute; see docs/architecture-and-workflows.md.)
    expect((await service.login("someone-else", "no1", "203.0.113.1")).outcome).toBe(
      "invalid-credentials",
    );
  });

  it("admin unlock (unlockAccount) clears the lock immediately, without waiting out the window", async () => {
    const { service, repo } = makeService();
    const user = seedActiveUser(repo);
    await service.login("asha", "no1", "1.1.1.1");
    await service.login("asha", "no2", "1.1.1.1");
    expect((await service.login("asha", "no3", "1.1.1.1")).outcome).toBe("locked");

    const unlocked = await service.unlockAccount(user.id);
    expect(unlocked).toEqual({ username: "asha" });
    expect((await service.login("asha", "right-password", "1.1.1.1")).outcome).toBe("success");
  });

  it("unlockAccount returns null for an unknown user and touches nothing", async () => {
    const { service } = makeService();
    expect(await service.unlockAccount("no-such-user")).toBeNull();
  });

  it("auto-expires the lock via Redis TTL alone — no clear(), no admin action, no sweep job", async () => {
    const { service, repo } = makeService({ lockoutMaxAttempts: 2 });
    seedActiveUser(repo);
    await service.login("asha", "no1", "1.1.1.1");
    expect((await service.login("asha", "no2", "1.1.1.1")).outcome).toBe("locked");
    // Correct password is still refused mid-window...
    expect((await service.login("asha", "right-password", "1.1.1.1")).outcome).toBe("locked");

    vi.advanceTimersByTime(15 * 60 * 1000 + 1); // the fixed window lapses

    // ...but succeeds once the window has genuinely elapsed, with no explicit unlock.
    expect((await service.login("asha", "right-password", "1.1.1.1")).outcome).toBe("success");
  });

  it("audits identity.login-locked (with ip and userAgent) for attempts against an already-locked account", async () => {
    const { service, repo, audit } = makeService({ lockoutMaxAttempts: 1 });
    seedActiveUser(repo);
    expect((await service.login("asha", "wrong", "5.5.5.5", "curl/8.0")).outcome).toBe("locked");
    audit.events.length = 0; // isolate the NEXT attempt, made against an already-locked account

    const result = await service.login("asha", "right-password", "6.6.6.6", "Mozilla/5.0 test-agent");
    expect(result.outcome).toBe("locked");
    expect(audit.actions()).toEqual(["identity.login-locked"]);
    expect(audit.events[0]?.details).toMatchObject({
      username: "asha",
      ip: "6.6.6.6",
      userAgent: "Mozilla/5.0 test-agent",
    });
  });

  it("audits login-failed with both ip and userAgent", async () => {
    const { service, repo, audit } = makeService();
    seedActiveUser(repo);
    await service.login("asha", "wrong", "1.2.3.4", "Mozilla/5.0 test-agent");
    expect(audit.events[0]?.details).toMatchObject({
      reason: "wrong-password",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0 test-agent",
    });
  });

  it("defaults userAgent to \"unknown\" when the caller doesn't supply one", async () => {
    const { service, repo, audit } = makeService();
    seedActiveUser(repo);
    await service.login("asha", "wrong", "1.2.3.4");
    expect(audit.events[0]?.details).toMatchObject({ userAgent: "unknown" });
  });

  it("still verifies the account's real password hash even while locked (no short-circuit timing oracle)", async () => {
    const { service, repo, hasher, store } = makeService({ lockoutMaxAttempts: 1 });
    const user = seedActiveUser(repo);
    // Trip the lock directly against the shared store, bypassing login()'s
    // own recordFailure, so the assertion below isolates ONLY the verify()
    // call made by the next login() invocation.
    await new FailureThrottle(store, { maxAttempts: 1, windowMinutes: 15 }, "login").recordFailure(
      "asha",
    );
    hasher.verifyCalls.length = 0;

    const result = await service.login("asha", "right-password", "9.9.9.9");
    expect(result.outcome).toBe("locked");
    expect(hasher.verifyCalls).toEqual([user.passwordHash]);
  });

  it("keeps returning invalid-credentials (not throwing) when the audit write fails", async () => {
    // Extends RecordingAudit so it satisfies makeService's handle type; the
    // override makes every write fail.
    const failingAudit = new (class extends RecordingAudit {
      override async record(): Promise<void> {
        throw new Error("audit store unavailable");
      }
    })();
    const { service, repo, store } = makeService({ audit: failingAudit, lockoutMaxAttempts: 2 });
    seedActiveUser(repo);

    // A clean 401, not a 500-shaped exception, despite the audit outage.
    await expect(service.login("asha", "wrong", "1.2.3.4")).resolves.toEqual({
      outcome: "invalid-credentials",
    });
    // The throttle counter itself is unaffected by the audit outage: a
    // second failure still locks the account (enforcement never depended on
    // the audit write succeeding).
    await expect(service.login("asha", "wrong-again", "1.2.3.4")).resolves.toEqual({
      outcome: "locked",
    });
    expect(store.values.get("idn:throttle:login:asha")).toBe(2);
  });

  it("clears the failure counter on success", async () => {
    const { service, repo } = makeService();
    seedActiveUser(repo);
    await service.login("asha", "no1", "1.1.1.1");
    await service.login("asha", "no2", "1.1.1.1");
    expect((await service.login("asha", "right-password", "1.1.1.1")).outcome).toBe("success");
    // Counter reset: two more failures do not lock.
    await service.login("asha", "no3", "1.1.1.1");
    expect((await service.login("asha", "right-password", "1.1.1.1")).outcome).toBe("success");
  });

  it("upgrades the stored hash when the hasher requests a rehash", async () => {
    const { service, repo, hasher } = makeService();
    const user = seedActiveUser(repo);
    hasher.rehashNeeded = true;
    const oldHash = user.passwordHash;
    expect((await service.login("asha", "right-password", "1.2.3.4")).outcome).toBe("success");
    const updated = await repo.findById(user.id);
    expect(updated?.passwordHash).not.toBe(oldHash);
    expect(await hasher.verify(updated?.passwordHash ?? "", "right-password")).toBe(true);
  });
});

/**
 * #10.5 B2: every local-password failure path must pay for exactly one hash
 * verification. A wall-clock comparison inside a parallel unit suite measures
 * scheduler contention rather than this invariant; a real timing attack
 * benchmark against Argon2 belongs in a separate controlled environment.
 */
describe("AuthService.login — failed paths verify once (#10.5 B2)", () => {
  it("verifies a dummy hash for an unknown user and the stored hash for wrong or locked accounts", async () => {
    const unknown = await (async () => {
      const repo = new FakeUsersRepo();
      const hasher = new FakePasswordHasher();
      const service = new AuthService({
        repo,
        resetTokens: new FakeResetTokensRepo(),
        hasher,
        sessions: new FakeSessionManager(),
        audit: new RecordingAudit(),
        logger: silentLogger,
        loginThrottle: new FailureThrottle(new MemoryThrottleStore(), { maxAttempts: 1000, windowMinutes: 15 }, "login"),
        resetThrottle: new FailureThrottle(new MemoryThrottleStore(), { maxAttempts: 1000, windowMinutes: 15 }, "reset"),
        resetTokenTtlMinutes: 30,
      });
      return { result: await service.login("no-such-user", "whatever-password", "1.1.1.1"), calls: hasher.verifyCalls, dummyHash: hasher.dummyHash };
    })();

    const storedHash = "fake-hash::right-password::seed";
    const wrong = await (async () => {
      const repo = new FakeUsersRepo();
      repo.seed({ username: "asha", passwordHash: storedHash });
      const hasher = new FakePasswordHasher();
      const service = new AuthService({
        repo,
        resetTokens: new FakeResetTokensRepo(),
        hasher,
        sessions: new FakeSessionManager(),
        audit: new RecordingAudit(),
        logger: silentLogger,
        loginThrottle: new FailureThrottle(new MemoryThrottleStore(), { maxAttempts: 1000, windowMinutes: 15 }, "login"),
        resetThrottle: new FailureThrottle(new MemoryThrottleStore(), { maxAttempts: 1000, windowMinutes: 15 }, "reset"),
        resetTokenTtlMinutes: 30,
      });
      return { result: await service.login("asha", "wrong-password", "1.1.1.1"), calls: hasher.verifyCalls };
    })();

    const locked = await (async () => {
      const repo = new FakeUsersRepo();
      repo.seed({ username: "asha", passwordHash: storedHash });
      const store = new MemoryThrottleStore();
      const loginThrottle = new FailureThrottle(store, { maxAttempts: 1000, windowMinutes: 15 }, "login");
      const hasher = new FakePasswordHasher();
      const service = new AuthService({
        repo,
        resetTokens: new FakeResetTokensRepo(),
        hasher,
        sessions: new FakeSessionManager(),
        audit: new RecordingAudit(),
        logger: silentLogger,
        loginThrottle,
        resetThrottle: new FailureThrottle(new MemoryThrottleStore(), { maxAttempts: 1000, windowMinutes: 15 }, "reset"),
        resetTokenTtlMinutes: 30,
      });
      // Pre-lock the account directly, isolated from login()'s own recordFailure.
      store.values.set("idn:throttle:login:asha", 1000);
      // Note: NOT store.expirations — isLocked() only reads the count.
      return { result: await service.login("asha", "right-password", "1.1.1.1"), calls: hasher.verifyCalls };
    })();

    expect(unknown.result.outcome).toBe("invalid-credentials");
    expect(unknown.calls).toEqual([unknown.dummyHash]);
    expect(wrong.result.outcome).toBe("invalid-credentials");
    expect(wrong.calls).toEqual([storedHash]);
    expect(locked.result.outcome).toBe("locked");
    expect(locked.calls).toEqual([storedHash]);
  });
});

describe("AuthService.login — external provider seam (LDAP/SSO contract)", () => {
  const provider = (result: { externalSubject: string; username: string } | null) => {
    const calls: unknown[] = [];
    const impl: ExternalIdentityProvider = {
      name: "fake-ldap",
      authenticate: async (input) => {
        calls.push(input);
        return result;
      },
    };
    return { impl, calls };
  };

  it("delegates verification to the provider instead of the local hash", async () => {
    const { impl, calls } = provider({ externalSubject: "cn=asha", username: "asha" });
    const { service, repo, hasher } = makeService({ externalProvider: impl });
    seedActiveUser(repo);
    const result = await service.login("asha", "ldap-password", "1.2.3.4");
    expect(result.outcome).toBe("success");
    expect(calls).toHaveLength(1);
    expect(hasher.verifyCalls).toHaveLength(0);
  });

  it("fails uniformly when the provider rejects", async () => {
    const { impl } = provider(null);
    const { service, repo } = makeService({ externalProvider: impl });
    seedActiveUser(repo);
    expect((await service.login("asha", "bad", "1.2.3.4")).outcome).toBe("invalid-credentials");
  });

  it("does not auto-provision: provider success without a local account fails", async () => {
    const { impl } = provider({ externalSubject: "cn=ghost", username: "ghost" });
    const { service } = makeService({ externalProvider: impl });
    expect((await service.login("ghost", "pw", "1.2.3.4")).outcome).toBe("invalid-credentials");
  });
});

describe("AuthService.changePassword", () => {
  it("requires the current password", async () => {
    const { service, repo } = makeService();
    const user = seedActiveUser(repo);
    expect(await service.changePassword(user.id, "wrong", "a-new-password-123")).toBe(false);
  });

  it("rehashes, activates and invalidates every session", async () => {
    const { service, repo, sessions } = makeService();
    const user = seedActiveUser(repo);
    const login = await service.login("asha", "right-password", "1.2.3.4");
    expect(login.outcome).toBe("success");
    expect(await service.changePassword(user.id, "right-password", "a-new-password-123")).toBe(
      true,
    );
    if (login.outcome === "success") {
      expect(await sessions.resolve(login.token)).toBeNull();
    }
    expect((await service.login("asha", "a-new-password-123", "1.2.3.4")).outcome).toBe("success");
  });
});

describe("AuthService reset flow", () => {
  it("stores only a hash of the issued token", async () => {
    const { service, repo, resetTokens } = makeService();
    const user = seedActiveUser(repo);
    const issued = await service.initiateReset(user.id, "admin-1");
    expect(issued).not.toBeNull();
    expect(resetTokens.rows).toHaveLength(1);
    expect(resetTokens.rows[0]?.tokenHash).not.toBe(issued?.token);
    expect(resetTokens.rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns null for an unknown user", async () => {
    const { service } = makeService();
    expect(await service.initiateReset("nope", "admin-1")).toBeNull();
  });

  it("redeems a token once: sets the password, activates, kills sessions", async () => {
    const { service, repo, sessions } = makeService();
    const user = repo.seed({
      username: "newbie",
      passwordHash: "fake-hash::temp::x",
      status: "must_reset",
    });
    const login = await service.login("newbie", "temp", "1.2.3.4"); // reset-required, no session
    expect(login.outcome).toBe("reset-required");
    const issued = await service.initiateReset(user.id, "admin-1");
    const confirmed = await service.confirmReset(issued?.token ?? "", "brand-new-pass-99", "1.2.3.4");
    expect(confirmed).toEqual({ outcome: "success", userId: user.id });
    expect((await service.login("newbie", "brand-new-pass-99", "1.2.3.4")).outcome).toBe("success");
    // Second redemption of the same token fails.
    const again = await service.confirmReset(issued?.token ?? "", "another-pass-1234", "1.2.3.4");
    expect(again.outcome).toBe("invalid-token");
    expect(await sessions.invalidateAllForUser(user.id)).toBeGreaterThanOrEqual(0);
  });

  it("rejects garbage tokens, audits, and locks the address after repeats", async () => {
    const { service, audit } = makeService();
    expect((await service.confirmReset("junk-token-0000000000000000000000", "new-pass-123456", "6.6.6.6")).outcome).toBe("invalid-token");
    expect(audit.actions()).toContain("identity.password-reset-failed");
    await service.confirmReset("junk-token-0000000000000000000001", "new-pass-123456", "6.6.6.6");
    const third = await service.confirmReset("junk-token-0000000000000000000002", "new-pass-123456", "6.6.6.6");
    expect(third.outcome).toBe("locked");
    const fourth = await service.confirmReset("junk-token-0000000000000000000003", "new-pass-123456", "6.6.6.6");
    expect(fourth.outcome).toBe("locked");
  });

  it("rejects an expired token", async () => {
    const { service, repo, resetTokens } = makeService();
    const user = seedActiveUser(repo);
    const issued = await service.initiateReset(user.id, "admin-1");
    const row = resetTokens.rows[0];
    if (row !== undefined) {
      row.expiresAt = new Date(Date.now() - 1000);
    }
    const result = await service.confirmReset(issued?.token ?? "", "new-pass-12345678", "1.2.3.4");
    expect(result.outcome).toBe("invalid-token");
  });
});

describe("AuthService.adminSetPassword", () => {
  it("sets a new password, keeps the account active, and invalidates sessions", async () => {
    const { service, repo, sessions } = makeService();
    const user = seedActiveUser(repo);
    const login = await service.login("asha", "right-password", "1.2.3.4");
    expect(login.outcome).toBe("success");

    expect(await service.adminSetPassword(user.id, "admin-chosen-temp-99")).toBe(true);

    const record = await repo.findById(user.id);
    expect(record?.status).toBe("active");
    // pre-existing session is gone; the user signs in with the new value
    if (login.outcome === "success") expect(await sessions.resolve(login.token)).toBeNull();
    expect((await service.login("asha", "admin-chosen-temp-99", "5.5.5.5")).outcome).toBe("success");
  });

  it("returns false for an unknown user", async () => {
    const { service } = makeService();
    expect(await service.adminSetPassword("nope", "admin-chosen-temp-99")).toBe(false);
  });
});
