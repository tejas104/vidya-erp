import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_PASSWORD, ADMIN_USERNAME, buildStack, type Stack } from "./support/harness";

/**
 * End-to-end identity flows through the REAL pipeline and the REAL
 * human-owned security core (argon2 hashing, split-token Redis sessions,
 * the grant-matrix scope-checker) against real Postgres/Redis.
 */

let stack: Stack;
let collegeId = "";
let adminCookie = "";
const runId = randomUUID().slice(0, 8);

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  collegeId = bootstrap.collegeId;
  adminCookie = bootstrap.adminCookie;
});

afterAll(async () => {
  await stack.close();
});

async function auditActions(limit = 100): Promise<string[]> {
  const rows = await stack.system.service.readRecentAuditEvents(limit);
  return rows.map((row) => row.action);
}

describe("session lifecycle (real argon2 + real session manager)", () => {
  it("rejects requests without a session and accepts the login cookie", async () => {
    expect((await stack.call("identity.session")).status).toBe(401);
    const whoami = await stack.call("identity.session", { cookie: adminCookie });
    expect(whoami.status).toBe(200);
    const body = (await whoami.json()) as { roles: string[]; grants: unknown[] };
    expect(body.roles).toContain("admin");
    expect(body.grants.length).toBeGreaterThan(0);
  });

  it("rejects a tampered session token", async () => {
    const flipped = adminCookie.slice(0, -1) + (adminCookie.endsWith("a") ? "b" : "a");
    expect((await stack.call("identity.session", { cookie: flipped })).status).toBe(401);
  });

  it("audits successful logins with the user as actor", async () => {
    const rows = await stack.system.service.readRecentAuditEvents(50);
    const loginRow = rows.find((row) => row.action === "identity.login");
    expect(loginRow).toBeDefined();
    expect(loginRow?.actorType).toBe("user");
    expect(loginRow?.actorId).not.toBeNull();
  });

  it("logout invalidates the session and audits", async () => {
    const cookie = await stack.login(ADMIN_USERNAME, ADMIN_PASSWORD);
    const logout = await stack.call("identity.logout", { cookie });
    expect(logout.status).toBe(200);
    expect((await stack.call("identity.session", { cookie })).status).toBe(401);
    expect(await auditActions()).toContain("identity.logout");
  });
});

describe("user administration end-to-end", () => {
  const username = `teacher-${runId}`;
  let userId = "";

  it("admin creates a user (must_reset) and the action is audited", async () => {
    const response = await stack.call("identity.user-create", {
      cookie: adminCookie,
      body: {
        username,
        displayName: "Integration Teacher",
        collegeId,
        temporaryPassword: "temporary-pass-123",
        roles: ["teacher"],
      },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; status: string };
    userId = body.id;
    expect(body.status).toBe("must_reset");
    expect(await auditActions()).toContain("identity.user-created");
  });

  it("must_reset blocks login until the admin-issued token is redeemed", async () => {
    const blocked = await stack.call("identity.login", {
      body: { username, password: "temporary-pass-123" },
    });
    expect(blocked.status).toBe(403);

    const init = await stack.call("identity.password-reset-init", {
      cookie: adminCookie,
      params: { userId },
    });
    expect(init.status).toBe(201);
    const { token } = (await init.json()) as { token: string };

    const confirm = await stack.call("identity.password-reset-confirm", {
      body: { token, newPassword: "brand-new-pass-99" },
    });
    expect(confirm.status).toBe(200);

    const reuse = await stack.call("identity.password-reset-confirm", {
      body: { token, newPassword: "another-pass-1234" },
      ip: "10.2.2.2",
    });
    expect(reuse.status).toBe(401);

    const login = await stack.call("identity.login", {
      body: { username, password: "brand-new-pass-99" },
    });
    expect(login.status).toBe(200);
    const actions = await auditActions();
    expect(actions).toContain("identity.password-reset-initiated");
    expect(actions).toContain("identity.password-reset-completed");
  });

  it("self-access (real matrix): the user reads their own profile but not the admin's", async () => {
    const cookie = await stack.login(username, "brand-new-pass-99");
    const own = await stack.call("identity.user-get", { cookie, params: { userId } });
    expect(own.status).toBe(200);

    const admins = await stack.pool.query(
      "SELECT user_id FROM idn_user_roles WHERE role = 'admin' LIMIT 1",
    );
    const adminId = String(admins.rows[0]?.user_id);
    const other = await stack.call("identity.user-get", { cookie, params: { userId: adminId } });
    expect(other.status).toBe(403);
  });

  it("route-level role gate: an authenticated non-admin cannot call management routes", async () => {
    const cookie = await stack.login(username, "brand-new-pass-99");
    const listing = await stack.call("identity.user-list", { cookie });
    expect(listing.status).toBe(403);
  });

  it("manual grants are verified against the real org tree (422 on unreal units)", async () => {
    const bogus = await stack.call("identity.grant-add", {
      cookie: adminCookie,
      params: { userId },
      body: {
        role: "teacher",
        collegeId,
        departmentId: "dep_ghost",
        classId: "cls_ghost",
        subjectId: "sub_ghost",
      },
    });
    expect(bogus.status).toBe(422);
  });

  it("role change kills the user's sessions and audits before/after", async () => {
    const cookie = await stack.login(username, "brand-new-pass-99");
    expect((await stack.call("identity.session", { cookie })).status).toBe(200);

    const set = await stack.call("identity.roles-set", {
      cookie: adminCookie,
      params: { userId },
      body: { roles: ["class_teacher"] },
    });
    expect(set.status).toBe(200);
    expect((await stack.call("identity.session", { cookie })).status).toBe(401);

    const rows = await stack.system.service.readRecentAuditEvents(20);
    const change = rows.find((row) => row.action === "identity.roles-changed");
    expect(change?.details).toMatchObject({ before: ["teacher"], after: ["class_teacher"] });
  });
});

describe("login throttling against real Redis", () => {
  it("locks the user+ip subject after repeated failures", async () => {
    const victim = `locked-${runId}`;
    const ip = "10.9.9.9";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await stack.call("identity.login", {
        body: { username: victim, password: `wrong-${attempt}` },
        ip,
      });
      expect(response.status).toBe(401);
    }
    const fifth = await stack.call("identity.login", {
      body: { username: victim, password: "wrong-5" },
      ip,
    });
    expect(fifth.status).toBe(429);
    expect(fifth.headers.get("retry-after")).toBe(String(15 * 60));
    expect(await auditActions()).toContain("identity.login-failed");
  });
});
