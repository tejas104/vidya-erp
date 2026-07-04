/**
 * TEST DOUBLE of the HUMAN-OWNED identity core, for exercising Fable-owned
 * plumbing (routes, middleware, audit, throttling) end-to-end before the
 * real core lands. Deliberately insecure by construction — the "hash"
 * embeds the password, tokens are random but unsigned, and the scope
 * checker implements only the two rules these tests need (admin-in-college
 * and read-own-profile), NOT the ADR-0010 matrix. The real core is
 * accepted only via the conformance suites in
 * packages/modules/identity/src/core/conformance.
 */

import { randomUUID } from "node:crypto";
import type { Principal, ResourceRef, ScopeChecker, ScopeDecision } from "@vidya/platform";
import type {
  IdentityCore,
  IssuedSession,
  PasswordHasher,
  SessionData,
  SessionManager,
  SessionRecord,
} from "@vidya/module-identity";

class TestPasswordHasher implements PasswordHasher {
  readonly dummyHash = "test-hash::__nobody__";
  async hash(password: string): Promise<string> {
    return `test-hash::${password}`;
  }
  async verify(hash: string, password: string): Promise<boolean> {
    return hash === `test-hash::${password}`;
  }
  needsRehash(): boolean {
    return false;
  }
}

class TestSessionManager implements SessionManager {
  private readonly byToken = new Map<string, SessionRecord>();

  async issue(data: SessionData): Promise<IssuedSession> {
    const sessionId = `sess-${randomUUID()}`;
    const token = `tok-${randomUUID()}${randomUUID()}`;
    const now = new Date();
    const record: SessionRecord = {
      ...data,
      sessionId,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    };
    this.byToken.set(token, record);
    return { token, sessionId, expiresAt: record.expiresAt };
  }

  async resolve(token: string): Promise<SessionRecord | null> {
    const record = this.byToken.get(token);
    return record !== undefined && record.expiresAt.getTime() > Date.now() ? record : null;
  }

  async invalidate(sessionId: string): Promise<void> {
    for (const [token, record] of this.byToken) {
      if (record.sessionId === sessionId) {
        this.byToken.delete(token);
      }
    }
  }

  async invalidateAllForUser(userId: string): Promise<number> {
    let count = 0;
    for (const [token, record] of this.byToken) {
      if (record.userId === userId) {
        this.byToken.delete(token);
        count += 1;
      }
    }
    return count;
  }
}

class TestScopeChecker implements ScopeChecker {
  check(caller: Principal, action: string, resource: ResourceRef): ScopeDecision {
    if (action === "read" && resource.ownerUserId === caller.id) {
      return { granted: true, reason: "test-double: self-access" };
    }
    const adminGrant = caller.grants.find(
      (grant) => grant.role === "admin" && grant.org.collegeId === resource.org.collegeId,
    );
    if (adminGrant !== undefined && resource.module === "identity") {
      return { granted: true, reason: "test-double: admin in college", matchedGrant: adminGrant };
    }
    return { granted: false, reason: "test-double: deny-by-default" };
  }
}

export function createTestIdentityCore(): IdentityCore {
  return {
    passwordHasher: new TestPasswordHasher(),
    sessionManager: new TestSessionManager(),
    scopeChecker: new TestScopeChecker(),
  };
}
