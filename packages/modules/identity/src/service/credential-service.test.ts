import { createHash } from "node:crypto";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { Role } from "@vidya/platform";
import { CredentialService } from "./credential-service";
import { UsersService } from "./users-service";
import { AuthService } from "./auth-service";
import { FailureThrottle } from "./throttle";
import type { PasswordHasher } from "../core/contracts";
import {
  FakeResetTokensRepo,
  FakeSessionManager,
  FakeUsersRepo,
  MemoryThrottleStore,
  RecordingAudit,
} from "../../test-support/fakes";

const silentLogger = pino({ level: "silent" });

/**
 * A genuinely opaque hasher, unlike test-support's FakePasswordHasher (which
 * deliberately embeds the plaintext in its "hash" string for OTHER tests'
 * convenience). This suite asserts the plaintext is never persisted, so the
 * double it runs against must behave like a real one: the stored value must
 * not contain the input.
 */
class OpaquePasswordHasher implements PasswordHasher {
  readonly dummyHash = createHash("sha256").update("dummy").digest("hex");
  async hash(password: string): Promise<string> {
    return createHash("sha256").update(password).digest("hex");
  }
  async verify(hash: string, password: string): Promise<boolean> {
    return hash === (await this.hash(password));
  }
  needsRehash(): boolean {
    return false;
  }
}

function makeService() {
  const repo = new FakeUsersRepo();
  const hasher = new OpaquePasswordHasher();
  const sessions = new FakeSessionManager();
  const audit = new RecordingAudit();
  const users = new UsersService({ repo, hasher, sessions, audit });
  const store = new MemoryThrottleStore();
  const auth = new AuthService({
    repo,
    resetTokens: new FakeResetTokensRepo(),
    hasher,
    sessions,
    audit,
    logger: silentLogger,
    loginThrottle: new FailureThrottle(store, { maxAttempts: 10, windowMinutes: 15 }, "login"),
    resetThrottle: new FailureThrottle(store, { maxAttempts: 10, windowMinutes: 15 }, "reset"),
    resetTokenTtlMinutes: 30,
  });
  const service = new CredentialService({ users });
  return { service, repo, hasher, sessions, audit, auth };
}

const input = {
  personName: "Ravi Kumar",
  username: "ravi.kumar",
  collegeId: "col-1",
  roles: ["student"] as readonly Role[],
  createdBy: "admin-1",
};

describe("CredentialService.issueCredential", () => {
  it("issues an ACTIVE account that can log in", async () => {
    const { service, repo, auth } = makeService();
    const issued = await service.issueCredential(input);
    const user = await repo.findByUsername(issued.username);
    expect(user?.status).toBe("active"); // NOT must_reset — login rejects that
    expect(issued.userId).toBe(user?.id); // #11 B4: callers link this back onto their own record
    const login = await auth.login(issued.username, issued.temporaryPassword, "1.2.3.4");
    expect(login.outcome).toBe("success");
  });

  it("returns the plaintext exactly once and never stores it", async () => {
    const { service, repo } = makeService();
    const issued = await service.issueCredential(input);
    expect(issued.temporaryPassword).toHaveLength(10);
    const user = await repo.findByUsername(issued.username);
    expect(JSON.stringify(user)).not.toContain(issued.temporaryPassword);
  });

  it("carries the requested roles and college onto the created account", async () => {
    const { service, repo } = makeService();
    const issued = await service.issueCredential(input);
    const user = await repo.findByUsername(issued.username);
    expect(user?.collegeId).toBe("col-1");
    expect(await repo.getRoles(user?.id ?? "")).toEqual(["student"]);
  });

  it("never audits the plaintext password", async () => {
    const { service, audit } = makeService();
    const issued = await service.issueCredential(input);
    expect(JSON.stringify(audit.events)).not.toContain(issued.temporaryPassword);
  });
});

describe("CredentialService.createGuardianAccount (ADR-0027)", () => {
  const guardian = { username: "parent.rao", displayName: "Meera Rao", collegeId: "col-1", password: "a-long-chosen-passphrase" };

  it("creates an active, role-less guardian account that can log in with the chosen password", async () => {
    const { service, repo, auth } = makeService();
    const created = await service.createGuardianAccount(guardian);
    const user = await repo.findById(created.userId);
    expect(user).toMatchObject({ status: "active", accountKind: "guardian" });
    expect(await repo.getRoles(created.userId)).toEqual([]);
    expect(JSON.stringify(user)).not.toContain(guardian.password);
    const login = await auth.login(guardian.username, guardian.password, "1.2.3.4");
    expect(login.outcome).toBe("success");
  });

  it("refuses to give a guardian account a staff role or a grant afterwards", async () => {
    const { service, repo } = makeService();
    const created = await service.createGuardianAccount(guardian);
    await expect(repo.setRoles(created.userId, ["admin"], "admin-1")).rejects.toThrow(/guardian/);
    await expect(repo.addRole(created.userId, "teacher", "derivation")).rejects.toThrow(/guardian/);
    await expect(
      repo.addGrant(created.userId, { role: "admin", org: { collegeId: "col-1" }, grantedBy: "admin-1" }),
    ).rejects.toThrow(/guardian/);
    // clearing roles stays allowed — it cannot add authority
    await expect(repo.setRoles(created.userId, [], "admin-1")).resolves.toBeUndefined();
  });
});
