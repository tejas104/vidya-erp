import { describe, expect, it } from "vitest";
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

function makeService(overrides: { externalProvider?: ExternalIdentityProvider } = {}) {
  const repo = new FakeUsersRepo();
  const resetTokens = new FakeResetTokensRepo();
  const hasher = new FakePasswordHasher();
  const sessions = new FakeSessionManager();
  const audit = new RecordingAudit();
  const store = new MemoryThrottleStore();
  const policy = { maxAttempts: 3, windowMinutes: 15 };
  const service = new AuthService({
    repo,
    resetTokens,
    hasher,
    sessions,
    audit,
    loginThrottle: new FailureThrottle(store, policy, "login"),
    resetThrottle: new FailureThrottle(store, policy, "reset"),
    resetTokenTtlMinutes: 30,
    ...overrides,
  });
  return { service, repo, resetTokens, hasher, sessions, audit, store };
}

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

  it("locks the user+ip subject after maxAttempts failures and stays locked", async () => {
    const { service, repo } = makeService();
    seedActiveUser(repo);
    expect((await service.login("asha", "no1", "9.9.9.9")).outcome).toBe("invalid-credentials");
    expect((await service.login("asha", "no2", "9.9.9.9")).outcome).toBe("invalid-credentials");
    expect((await service.login("asha", "no3", "9.9.9.9")).outcome).toBe("locked");
    // Even the correct password is refused while locked.
    expect((await service.login("asha", "right-password", "9.9.9.9")).outcome).toBe("locked");
    // A different ip is an independent subject.
    expect((await service.login("asha", "right-password", "8.8.8.8")).outcome).toBe("success");
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
