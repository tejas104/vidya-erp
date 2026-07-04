import { createHash, randomBytes } from "node:crypto";
import type { AuditLogger } from "@vidya/platform";
import type { PasswordHasher, SessionManager } from "../core/contracts";
import type { ExternalIdentityProvider } from "../providers/external";
import { grantToScopeGrant, type UsersRepo } from "../repo/users-repo";
import type { ResetTokensRepo } from "../repo/reset-tokens-repo";
import type { FailureThrottle } from "./throttle";

export type LoginResult =
  | {
      readonly outcome: "success";
      readonly token: string;
      readonly sessionId: string;
      readonly expiresAt: Date;
      readonly user: { id: string; displayName: string; roles: readonly string[] };
    }
  | { readonly outcome: "invalid-credentials" }
  | { readonly outcome: "locked" }
  | { readonly outcome: "reset-required" };

export type ResetConfirmResult =
  | { readonly outcome: "success"; readonly userId: string }
  | { readonly outcome: "invalid-token" }
  | { readonly outcome: "locked" };

export interface AuthServiceDeps {
  readonly repo: UsersRepo;
  readonly resetTokens: ResetTokensRepo;
  readonly hasher: PasswordHasher;
  readonly sessions: SessionManager;
  readonly audit: AuditLogger;
  readonly loginThrottle: FailureThrottle;
  readonly resetThrottle: FailureThrottle;
  readonly resetTokenTtlMinutes: number;
  /**
   * LDAP/AD/SSO integration point (documented contract, no provider in #2).
   * When wired, external verification replaces the local password check;
   * the account must still exist locally (no auto-provisioning).
   */
  readonly externalProvider?: ExternalIdentityProvider;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Authentication choreography (Fable-owned). The credential primitive
 * (hash/verify), session issuance and invalidation are HUMAN-OWNED and
 * reached only through their contracts.
 *
 * Uniform failure surface: unknown user, wrong password and disabled
 * account all yield "invalid-credentials", and unknown users burn a dummy
 * verification so response timing does not reveal account existence.
 */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  private async fail(
    subject: string,
    username: string,
    ip: string,
    reason: string,
  ): Promise<LoginResult> {
    const { locked } = await this.deps.loginThrottle.recordFailure(subject);
    await this.deps.audit.record({
      module: "identity",
      action: "identity.login-failed",
      actorType: "system",
      actorId: null,
      resourceType: "session",
      resourceId: null,
      requestId: null,
      details: { username, ip, reason, locked },
    });
    return { outcome: locked ? "locked" : "invalid-credentials" };
  }

  async login(username: string, password: string, ip: string): Promise<LoginResult> {
    const subject = `${username.toLowerCase()}|${ip}`;
    if (await this.deps.loginThrottle.isLocked(subject)) {
      return { outcome: "locked" };
    }

    const user = await this.deps.repo.findByUsername(username);

    let credentialOk: boolean;
    if (this.deps.externalProvider !== undefined) {
      const external = await this.deps.externalProvider.authenticate({ username, password });
      credentialOk = external !== null && user !== null;
    } else if (user === null) {
      // Burn comparable time for unknown users (enumeration resistance).
      await this.deps.hasher.verify(this.deps.hasher.dummyHash, password);
      credentialOk = false;
    } else {
      credentialOk = await this.deps.hasher.verify(user.passwordHash, password);
    }

    if (user === null || !credentialOk) {
      return this.fail(subject, username, ip, user === null ? "unknown-user" : "wrong-password");
    }
    if (user.status === "disabled") {
      return this.fail(subject, username, ip, "account-disabled");
    }
    if (user.status === "must_reset") {
      await this.deps.audit.record({
        module: "identity",
        action: "identity.login-blocked-reset-required",
        actorType: "user",
        actorId: user.id,
        resourceType: "session",
        resourceId: null,
        requestId: null,
        details: { username, ip },
      });
      return { outcome: "reset-required" };
    }

    await this.deps.loginThrottle.clear(subject);

    if (this.deps.externalProvider === undefined && this.deps.hasher.needsRehash(user.passwordHash)) {
      const upgraded = await this.deps.hasher.hash(password);
      await this.deps.repo.updatePasswordHash(user.id, upgraded, user.status);
    }

    const [roles, grants] = await Promise.all([
      this.deps.repo.getRoles(user.id),
      this.deps.repo.getGrants(user.id),
    ]);
    const issued = await this.deps.sessions.issue({
      userId: user.id,
      displayName: user.displayName,
      roles,
      grants: grants.map(grantToScopeGrant),
    });
    return {
      outcome: "success",
      token: issued.token,
      sessionId: issued.sessionId,
      expiresAt: issued.expiresAt,
      user: { id: user.id, displayName: user.displayName, roles },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.deps.sessions.invalidate(sessionId);
  }

  /** Returns false when the current password does not verify. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const user = await this.deps.repo.findById(userId);
    if (user === null) {
      return false;
    }
    const ok = await this.deps.hasher.verify(user.passwordHash, currentPassword);
    if (!ok) {
      return false;
    }
    const passwordHash = await this.deps.hasher.hash(newPassword);
    await this.deps.repo.updatePasswordHash(userId, passwordHash, "active");
    await this.deps.sessions.invalidateAllForUser(userId);
    return true;
  }

  /**
   * Admin-initiated reset (ADR-0011): mints a one-time token, stores only
   * its SHA-256, returns the plaintext ONCE for out-of-band delivery.
   */
  async initiateReset(
    userId: string,
    createdBy: string,
  ): Promise<{ token: string; expiresAt: Date } | null> {
    const user = await this.deps.repo.findById(userId);
    if (user === null) {
      return null;
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.deps.resetTokenTtlMinutes * 60_000);
    await this.deps.resetTokens.create({
      userId,
      tokenHash: sha256Hex(token),
      expiresAt,
      createdBy,
    });
    return { token, expiresAt };
  }

  async confirmReset(
    token: string,
    newPassword: string,
    ip: string,
  ): Promise<ResetConfirmResult> {
    if (await this.deps.resetThrottle.isLocked(ip)) {
      return { outcome: "locked" };
    }
    const now = new Date();
    const match = await this.deps.resetTokens.findValidByHash(sha256Hex(token), now);
    if (match === null) {
      const { locked } = await this.deps.resetThrottle.recordFailure(ip);
      await this.deps.audit.record({
        module: "identity",
        action: "identity.password-reset-failed",
        actorType: "system",
        actorId: null,
        resourceType: "user",
        resourceId: null,
        requestId: null,
        details: { ip, locked },
      });
      return { outcome: locked ? "locked" : "invalid-token" };
    }
    await this.deps.resetTokens.markUsed(match.id, now);
    const passwordHash = await this.deps.hasher.hash(newPassword);
    await this.deps.repo.updatePasswordHash(match.userId, passwordHash, "active");
    await this.deps.sessions.invalidateAllForUser(match.userId);
    await this.deps.resetThrottle.clear(ip);
    return { outcome: "success", userId: match.userId };
  }
}
