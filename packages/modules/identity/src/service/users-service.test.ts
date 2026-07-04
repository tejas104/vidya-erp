import { describe, expect, it } from "vitest";
import { UsersService } from "./users-service";
import {
  FakePasswordHasher,
  FakeSessionManager,
  FakeUsersRepo,
  RecordingAudit,
} from "../../test-support/fakes";

function makeService() {
  const repo = new FakeUsersRepo();
  const hasher = new FakePasswordHasher();
  const sessions = new FakeSessionManager();
  const audit = new RecordingAudit();
  const service = new UsersService({ repo, hasher, sessions, audit });
  return { service, repo, hasher, sessions, audit };
}

describe("UsersService.createUser", () => {
  it("hashes the temporary password and starts the account in must_reset", async () => {
    const { service, repo, hasher } = makeService();
    const view = await service.createUser({
      username: "ravi",
      displayName: "Ravi Kumar",
      collegeId: "col-1",
      temporaryPassword: "temporary-pass-123",
      roles: ["teacher"],
      createdBy: "admin-1",
    });
    expect(view.status).toBe("must_reset");
    expect(view.roles).toEqual(["teacher"]);
    const record = await repo.findById(view.id);
    expect(record?.passwordHash).not.toBe("temporary-pass-123");
    expect(await hasher.verify(record?.passwordHash ?? "", "temporary-pass-123")).toBe(true);
    expect(await hasher.verify(record?.passwordHash ?? "", "some-other-password")).toBe(false);
  });
});

describe("UsersService reads", () => {
  it("getUser formats roles and grants into the view; unknown ids yield null", async () => {
    const { service, repo } = makeService();
    const user = repo.seed({
      username: "asha",
      passwordHash: "h",
      roles: ["teacher"],
      grants: [
        {
          id: "g1",
          role: "teacher",
          org: { collegeId: "col-1", departmentId: "d", classId: "c", sectionId: "s" },
          subjectId: "sub",
          verified: false,
        },
      ],
    });
    const view = await service.getUser(user.id);
    expect(view?.grants).toEqual([
      {
        id: "g1",
        role: "teacher",
        collegeId: "col-1",
        departmentId: "d",
        classId: "c",
        sectionId: "s",
        subjectId: "sub",
        verified: false,
      },
    ]);
    expect(await service.getUser("ghost")).toBeNull();
    expect(await service.getUserRecord(user.id)).not.toBeNull();
  });

  it("listUsers filters by college and paginates", async () => {
    const { service, repo } = makeService();
    repo.seed({ username: "a1", passwordHash: "h", collegeId: "col-1" });
    repo.seed({ username: "a2", passwordHash: "h", collegeId: "col-1" });
    repo.seed({ username: "b1", passwordHash: "h", collegeId: "col-2" });
    const firstPage = await service.listUsers("col-1", 1, 0);
    const secondPage = await service.listUsers("col-1", 1, 1);
    expect(firstPage.map((user) => user.username)).toEqual(["a1"]);
    expect(secondPage.map((user) => user.username)).toEqual(["a2"]);
    expect(await service.listUsers("col-3", 10, 0)).toEqual([]);
  });

  it("updateUser tolerates the row vanishing between read and write (race guard)", async () => {
    class RacyRepo extends FakeUsersRepo {
      override async update(): Promise<null> {
        return null;
      }
    }
    const repo = new RacyRepo();
    const user = repo.seed({ username: "asha", passwordHash: "h" });
    const service = new UsersService({
      repo,
      hasher: new FakePasswordHasher(),
      sessions: new FakeSessionManager(),
      audit: new RecordingAudit(),
    });
    expect(await service.updateUser(user.id, { displayName: "X" })).toBeNull();
  });

  it("updateUser and addGrant yield null for unknown users", async () => {
    const { service } = makeService();
    expect(await service.updateUser("ghost", { displayName: "X" })).toBeNull();
    expect(
      await service.addGrant("ghost", {
        role: "hod",
        org: { collegeId: "col-1", departmentId: "d" },
        grantedBy: "admin-1",
      }),
    ).toBeNull();
  });
});

describe("UsersService.setRoles", () => {
  it("reports before/after, cascades grants of revoked roles, kills sessions", async () => {
    const { service, repo, sessions } = makeService();
    const user = repo.seed({
      username: "asha",
      passwordHash: "fake-hash::x::1",
      roles: ["teacher", "class_teacher"],
      grants: [
        { id: "g1", role: "teacher", org: { collegeId: "col-1", departmentId: "d", classId: "c" }, subjectId: "s", verified: false },
        { id: "g2", role: "class_teacher", org: { collegeId: "col-1", departmentId: "d", classId: "c" }, verified: false },
      ],
    });
    const session = await sessions.issue({ userId: user.id, displayName: "x", roles: [], grants: [] });
    const change = await service.setRoles(user.id, ["teacher"], "admin-1");
    expect(change).toEqual({ before: ["class_teacher", "teacher"], after: ["teacher"] });
    expect(await repo.getGrants(user.id)).toHaveLength(1);
    expect(await sessions.resolve(session.token)).toBeNull();
  });

  it("returns null for an unknown user", async () => {
    const { service } = makeService();
    expect(await service.setRoles("ghost", ["teacher"], "admin-1")).toBeNull();
  });
});

describe("UsersService grants", () => {
  it("adds a grant and invalidates sessions", async () => {
    const { service, repo, sessions } = makeService();
    const user = repo.seed({ username: "asha", passwordHash: "h", roles: ["hod"] });
    const session = await sessions.issue({ userId: user.id, displayName: "x", roles: [], grants: [] });
    const stored = await service.addGrant(user.id, {
      role: "hod",
      org: { collegeId: "col-1", departmentId: "dep-sci" },
      grantedBy: "admin-1",
    });
    expect(stored?.verified).toBe(false);
    expect(await sessions.resolve(session.token)).toBeNull();
  });

  it("removes a grant and reports a missing one", async () => {
    const { service, repo } = makeService();
    const user = repo.seed({
      username: "asha",
      passwordHash: "h",
      roles: ["hod"],
      grants: [{ id: "g1", role: "hod", org: { collegeId: "col-1", departmentId: "d" }, verified: false }],
    });
    expect(await service.removeGrant(user.id, "g1")).toBe(true);
    expect(await service.removeGrant(user.id, "g1")).toBe(false);
    expect(await service.removeGrant("ghost", "g1")).toBeNull();
  });
});

describe("UsersService.updateUser", () => {
  it("disabling an account invalidates its sessions", async () => {
    const { service, repo, sessions } = makeService();
    const user = repo.seed({ username: "asha", passwordHash: "h" });
    const session = await sessions.issue({ userId: user.id, displayName: "x", roles: [], grants: [] });
    const updated = await service.updateUser(user.id, { status: "disabled" });
    expect(updated?.status).toBe("disabled");
    expect(await sessions.resolve(session.token)).toBeNull();
  });

  it("a display-name change keeps sessions alive", async () => {
    const { service, repo, sessions } = makeService();
    const user = repo.seed({ username: "asha", passwordHash: "h" });
    const session = await sessions.issue({ userId: user.id, displayName: "x", roles: [], grants: [] });
    await service.updateUser(user.id, { displayName: "Asha V." });
    expect(await sessions.resolve(session.token)).not.toBeNull();
  });
});

describe("UsersService.bootstrapAdmin", () => {
  it("creates the first admin active, college-scoped, and audited as system", async () => {
    const { service, repo, audit } = makeService();
    const { userId } = await service.bootstrapAdmin({
      username: "root-admin",
      displayName: "Root Admin",
      password: "initial-admin-pass-1",
      collegeId: "col-1",
    });
    const record = await repo.findById(userId);
    expect(record?.status).toBe("active");
    expect(await repo.getRoles(userId)).toEqual(["admin"]);
    expect(await repo.getGrants(userId)).toEqual([
      expect.objectContaining({ role: "admin", org: { collegeId: "col-1" } }),
    ]);
    expect(audit.events[0]).toMatchObject({
      action: "identity.bootstrap-admin",
      actorType: "system",
      resourceId: userId,
    });
  });

  it("refuses when any admin already exists", async () => {
    const { service, repo } = makeService();
    repo.seed({ username: "existing", passwordHash: "h", roles: ["admin"] });
    await expect(
      service.bootstrapAdmin({
        username: "second",
        displayName: "Second",
        password: "whatever-pass-123",
        collegeId: "col-1",
      }),
    ).rejects.toThrow(/bootstrap refused/);
  });
});
