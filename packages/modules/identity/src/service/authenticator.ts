import type { AuthnDecision, AuthnRequest, Authenticator } from "@vidya/platform";
import type { SessionManager } from "../core/contracts";
import { parseCookies, type CookiePolicy } from "./cookies";

/**
 * The #2 replacement for DenyAllAuthenticator (Fable-owned plumbing):
 * extracts the session cookie and asks the HUMAN-OWNED SessionManager to
 * resolve it. Zero database reads on the hot path — roles and grants ride
 * in the session snapshot; authority changes invalidate sessions instead.
 */
export class SessionAuthenticator implements Authenticator {
  /**
   * `accountKindOf` resolves ADR-0027's guardian principals. It is consulted
   * ONLY for a session holding no roles and no grants — the one shape a
   * guardian session can have — so staff requests keep zero database reads.
   * Omitted (tests, or before wiring) ⇒ every session is a "user", which is
   * fail-closed: a role-less "user" holds no authority, and guardian-audience
   * routes refuse it.
   */
  constructor(
    private readonly sessions: SessionManager,
    private readonly cookiePolicy: CookiePolicy,
    private readonly accountKindOf?: (userId: string) => Promise<"staff" | "guardian" | null>,
  ) {}

  async authenticate(request: AuthnRequest): Promise<AuthnDecision> {
    const cookies = parseCookies(request.headers.get("cookie"));
    const token = cookies[this.cookiePolicy.name];
    if (token === undefined || token === "") {
      return { authenticated: false, reason: "no session cookie" };
    }
    const record = await this.sessions.resolve(token);
    if (record === null) {
      return { authenticated: false, reason: "session invalid or expired" };
    }
    const isGuardian =
      this.accountKindOf !== undefined &&
      record.roles.length === 0 &&
      record.grants.length === 0 &&
      (await this.accountKindOf(record.userId)) === "guardian";
    return {
      authenticated: true,
      principal: {
        id: record.userId,
        kind: isGuardian ? "guardian" : "user",
        displayName: record.displayName,
        roles: record.roles,
        scopes: [],
        grants: record.grants,
        sessionId: record.sessionId,
      },
    };
  }
}
