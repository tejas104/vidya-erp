import { createHash, randomBytes } from "node:crypto";
import type { AuditEvent, AuditLogger, Logger } from "@vidya/platform";
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
  readonly logger: Logger;
  /** Account lockout (#10.5 Part 2): keyed by account (username) alone. */
  readonly loginThrottle: FailureThrottle;
  /** Reset-token redemption throttle: keyed by IP. */
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
 * Uniform failure surface: unknown user, wrong password, disabled account
 * and a locked account all yield the SAME timing profile — unknown users
 * burn a dummy verification and a locked account still runs the real (or
 * dummy) verification before the lock is even consulted, so response timing
 * never reveals account existence OR lock state (see login() below and the
 * #10.5 B2 report's timing-evidence tests).
 *
 * Account lockout (#10.5 Part 2): loginThrottle is keyed by account
 * (username) alone — deliberately NOT combined with IP. This is a conscious
 * trade documented in docs/threat-model-identity.md: a pure per-account
 * counter can be tripped by an attacker who doesn't know the password (a
 * "lock the victim out" harassment vector), but per-(user,IP) keying can't
 * satisfy "10 consecutive failures for one account" or a single-action admin
 * unlock, and B1's per-IP backoff limiter plus admin early-unlock
 * (unlockAccount) bound the residual risk.
 */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  /**
   * Best-effort audit write for auth-FAILURE events (login-failed,
   * login-locked, reset-required, reset-token-failed): a rejection is
   * logged and swallowed, NEVER rethrown. Deliberate choice (#10.5 B2 —
   * see the report): AuditLogger's contract has the http pipeline fail the
   * REQUEST when a state-changing SUCCESS can't be audited, which is fine
   * because that pipeline path only runs for successes. These calls sit
   * inside the service, on the FAILURE branches, where nothing succeeded
   * and nothing needs to durably persist for the response to be correct —
   * letting an audit-store outage propagate here would turn a clean
   * 401/429 into a 500, i.e. turn an audit outage into a login outage. The
   * throttle counter itself (Redis) is unaffected by this and still
   * enforces the lock even if the audit row is lost.
   */
  private async auditBestEffort(event: AuditEvent): Promise<void> {
    try {
      await this.deps.audit.record(event);
    } catch (error) {
      this.deps.logger.error(
        { err: error, action: event.action },
        "auth-failure audit write failed; continuing without it (deliberate fail-open, #10.5 B2)",
      );
    }
  }

  private async fail(
    accountKey: string,
    username: string,
    ip: string,
    userAgent: string,
    reason: string,
  ): Promise<LoginResult> {
    const { locked } = await this.deps.loginThrottle.recordFailure(accountKey);
    await this.auditBestEffort({
      module: "identity",
      action: "identity.login-failed",
      actorType: "system",
      actorId: null,
      resourceType: "session",
      resourceId: null,
      requestId: null,
      details: { username, ip, userAgent, reason, locked },
    });
    return { outcome: locked ? "locked" : "invalid-credentials" };
  }

  async login(
    username: string,
    password: string,
    ip: string,
    userAgent = "unknown",
  ): Promise<LoginResult> {
    const accountKey = username.toLowerCase();

    // Read the lock state and the account in parallel, but do NOT branch on
    // it yet — see the ordering note below.
    const [user, alreadyLocked] = await Promise.all([
      this.deps.repo.findByUsername(username),
      this.deps.loginThrottle.isLocked(accountKey),
    ]);

    let credentialOk: boolean;
    if (this.deps.externalProvider !== undefined) {
      const external = await this.deps.externalProvider.authenticate({ username, password });
      credentialOk = external !== null && user !== null;
    } else if (user === null) {
      // Burn comparable time for unknown users (enumeration resistance).
      await this.deps.hasher.verify(this.deps.hasher.dummyHash, password);
      credentialOk = false;
    } else {
      // Verified even when already locked (see below): skipping this for a
      // locked account would make lock state itself a timing oracle for
      // account enumeration — a fast "locked" reply vs. a slow hash-verified
      // "invalid-credentials" reply would tell an attacker which usernames
      // exist. The lock decision is made AFTER this call, never before it.
      credentialOk = await this.deps.hasher.verify(user.passwordHash, password);
    }

    if (alreadyLocked) {
      await this.auditBestEffort({
        module: "identity",
        action: "identity.login-locked",
        actorType: "system",
        actorId: null,
        resourceType: "session",
        resourceId: null,
        requestId: null,
        details: { username, ip, userAgent },
      });
      return { outcome: "locked" };
    }

    if (user === null || !credentialOk) {
      return this.fail(
        accountKey,
        username,
        ip,
        userAgent,
        user === null ? "unknown-user" : "wrong-password",
      );
    }
    if (user.status === "disabled") {
      return this.fail(accountKey, username, ip, userAgent, "account-disabled");
    }
    if (user.status === "must_reset") {
      await this.auditBestEffort({
        module: "identity",
        action: "identity.login-blocked-reset-required",
        actorType: "user",
        actorId: user.id,
        resourceType: "session",
        resourceId: null,
        requestId: null,
        details: { username, ip, userAgent },
      });
      return { outcome: "reset-required" };
    }

    await this.deps.loginThrottle.clear(accountKey);

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
   * Admin sets a user's password directly (owner-ratified ADR-0011 deviation):
   * unlike initiateReset, the admin supplies the value. The account is set
   * ACTIVE so the user can sign in with it right away — the login flow blocks
   * must_reset accounts, so a change-on-next-login cannot be forced without
   * changing that choreography (deferred, human-owned). Every session of the
   * user is invalidated. The password is never returned, logged or audited.
   */
  async adminSetPassword(userId: string, newPassword: string): Promise<boolean> {
    const user = await this.deps.repo.findById(userId);
    if (user === null) {
      return false;
    }
    const passwordHash = await this.deps.hasher.hash(newPassword);
    await this.deps.repo.updatePasswordHash(userId, passwordHash, "active");
    await this.deps.sessions.invalidateAllForUser(userId);
    return true;
  }

  /**
   * Admin early-unlock (user-management action, #10.5 Part 2): clears the
   * consecutive-failure counter driving login lockout so the account can
   * sign in again immediately, without waiting out the 15-minute window.
   * Does not touch the password or any session — orthogonal to
   * adminSetPassword/initiateReset.
   *
   * Unlike the auditBestEffort auth-failure events above, THIS action is
   * audited by the caller (the HTTP handler) through the normal
   * state-changing-route path, which fails the request if the write fails.
   * That asymmetry is deliberate: bypassing a lockout is a sensitive
   * privileged action, and losing its audit trail should block the action
   * rather than silently let it through — the opposite risk profile from an
   * ordinary failed login.
   */
  async unlockAccount(userId: string): Promise<{ readonly username: string } | null> {
    const user = await this.deps.repo.findById(userId);
    if (user === null) {
      return null;
    }
    await this.deps.loginThrottle.clear(user.username.toLowerCase());
    return { username: user.username };
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
    userAgent = "unknown",
  ): Promise<ResetConfirmResult> {
    if (await this.deps.resetThrottle.isLocked(ip)) {
      return { outcome: "locked" };
    }
    const now = new Date();
    const match = await this.deps.resetTokens.findValidByHash(sha256Hex(token), now);
    if (match === null) {
      const { locked } = await this.deps.resetThrottle.recordFailure(ip);
      await this.auditBestEffort({
        module: "identity",
        action: "identity.password-reset-failed",
        actorType: "system",
        actorId: null,
        resourceType: "user",
        resourceId: null,
        requestId: null,
        details: { ip, userAgent, locked },
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
