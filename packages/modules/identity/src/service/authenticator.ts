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
  constructor(
    private readonly sessions: SessionManager,
    private readonly cookiePolicy: CookiePolicy,
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
    return {
      authenticated: true,
      principal: {
        id: record.userId,
        kind: "user",
        displayName: record.displayName,
        roles: record.roles,
        scopes: [],
        grants: record.grants,
        sessionId: record.sessionId,
      },
    };
  }
}
