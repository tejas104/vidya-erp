import { describe, expect, it } from "vitest";
import { SessionAuthenticator } from "./authenticator";
import { FakeSessionManager } from "../../test-support/fakes";

const policy = { name: "vidya_session", secure: true };

function request(cookie?: string) {
  return {
    headers: new Headers(cookie === undefined ? {} : { cookie }),
    method: "GET",
    path: "/api/v1/x",
    requestId: "req-1",
  };
}

describe("SessionAuthenticator", () => {
  it("rejects requests without a session cookie", async () => {
    const authenticator = new SessionAuthenticator(new FakeSessionManager(), policy);
    const decision = await authenticator.authenticate(request());
    expect(decision.authenticated).toBe(false);
    if (!decision.authenticated) {
      expect(decision.reason).toContain("no session cookie");
    }
  });

  it("rejects empty and unknown tokens", async () => {
    const sessions = new FakeSessionManager();
    const authenticator = new SessionAuthenticator(sessions, policy);
    expect((await authenticator.authenticate(request("vidya_session="))).authenticated).toBe(false);
    expect(
      (await authenticator.authenticate(request("vidya_session=unknown-token"))).authenticated,
    ).toBe(false);
  });

  it("maps a resolved session onto the Principal (roles+grants snapshot)", async () => {
    const sessions = new FakeSessionManager();
    const issued = await sessions.issue({
      userId: "u1",
      displayName: "Asha",
      roles: ["teacher"],
      grants: [{ role: "teacher", org: { collegeId: "c1", departmentId: "d", classId: "k" }, subjectId: "s" }],
    });
    const authenticator = new SessionAuthenticator(sessions, policy);
    const decision = await authenticator.authenticate(
      request(`other=1; vidya_session=${issued.token}`),
    );
    expect(decision.authenticated).toBe(true);
    if (decision.authenticated) {
      expect(decision.principal).toMatchObject({
        id: "u1",
        kind: "user",
        displayName: "Asha",
        roles: ["teacher"],
        sessionId: issued.sessionId,
      });
      expect(decision.principal.grants).toHaveLength(1);
    }
  });

  describe("guardian principals (ADR-0027)", () => {
    const kinds = new Map<string, "staff" | "guardian">([["g1", "guardian"], ["u1", "staff"]]);
    let lookups = 0;
    const accountKindOf = async (userId: string) => {
      lookups += 1;
      return kinds.get(userId) ?? null;
    };

    it("marks a role-less, grant-less guardian account as kind guardian", async () => {
      const sessions = new FakeSessionManager();
      const issued = await sessions.issue({ userId: "g1", displayName: "Parent", roles: [], grants: [] });
      const decision = await new SessionAuthenticator(sessions, policy, accountKindOf).authenticate(request(`vidya_session=${issued.token}`));
      expect(decision.authenticated && decision.principal).toMatchObject({ kind: "guardian", roles: [], grants: [] });
    });

    it("leaves a role-less staff account as kind user", async () => {
      const sessions = new FakeSessionManager();
      const issued = await sessions.issue({ userId: "u1", displayName: "Clerk", roles: [], grants: [] });
      const decision = await new SessionAuthenticator(sessions, policy, accountKindOf).authenticate(request(`vidya_session=${issued.token}`));
      expect(decision.authenticated && decision.principal.kind).toBe("user");
    });

    it("never looks up a session that holds roles — staff requests stay read-free", async () => {
      const sessions = new FakeSessionManager();
      const issued = await sessions.issue({ userId: "g1", displayName: "X", roles: ["teacher"], grants: [] });
      lookups = 0;
      const decision = await new SessionAuthenticator(sessions, policy, accountKindOf).authenticate(request(`vidya_session=${issued.token}`));
      expect(lookups).toBe(0);
      expect(decision.authenticated && decision.principal.kind).toBe("user");
    });
  });
});
