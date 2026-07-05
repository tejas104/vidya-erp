import { describe, expect, it } from "vitest";
import { DerivedGrantsService, type DerivedGrantInput } from "./derived-grants";
import {
  FakeSessionManager,
  FakeUsersRepo,
  RecordingAudit,
} from "../../test-support/fakes";

function makeService() {
  const repo = new FakeUsersRepo();
  const sessions = new FakeSessionManager();
  const audit = new RecordingAudit();
  const service = new DerivedGrantsService(repo, sessions, audit);
  return { service, repo, sessions, audit };
}

const input: DerivedGrantInput = {
  userId: "u1",
  role: "teacher",
  org: { collegeId: "col-1", departmentId: "dep-1", classId: "cls-1" },
  subjectId: "sub-1",
  sourceRef: "people:assignment:a1",
};

describe("DerivedGrantsService.upsert", () => {
  it("creates a verified derived grant, ensures the role, kills sessions, audits", async () => {
    const { service, repo, sessions, audit } = makeService();
    repo.seed({ id: "u1", username: "asha", passwordHash: "h", roles: [] });
    const session = await sessions.issue({ userId: "u1", displayName: "A", roles: [], grants: [] });

    const result = await service.upsert(input);
    expect(result.changed).toBe(true);

    expect(await repo.getRoles("u1")).toContain("teacher");
    const grants = await repo.getGrants("u1");
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      role: "teacher",
      subjectId: "sub-1",
      verified: true,
      source: "derived",
      sourceRef: "people:assignment:a1",
    });
    expect(await sessions.resolve(session.token)).toBeNull();
    expect(audit.actions()).toContain("identity.grant-derived");
  });

  it("is idempotent — the same input changes nothing and keeps sessions alive", async () => {
    const { service, repo, sessions } = makeService();
    repo.seed({ id: "u1", username: "asha", passwordHash: "h", roles: [] });
    await service.upsert(input);
    const session = await sessions.issue({ userId: "u1", displayName: "A", roles: [], grants: [] });
    const second = await service.upsert(input);
    expect(second.changed).toBe(false);
    expect(await repo.getGrants("u1")).toHaveLength(1);
    expect(await sessions.resolve(session.token)).not.toBeNull();
  });

  it("replaces the grant when the assignment's target changes", async () => {
    const { service, repo } = makeService();
    repo.seed({ id: "u1", username: "asha", passwordHash: "h", roles: [] });
    await service.upsert(input);
    await service.upsert({ ...input, subjectId: "sub-2" });
    const grants = await repo.getGrants("u1");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.subjectId).toBe("sub-2");
  });

  it("moves the grant (and invalidates both users) when the assignment changes teacher", async () => {
    const { service, repo, sessions } = makeService();
    repo.seed({ id: "u1", username: "asha", passwordHash: "h", roles: [] });
    repo.seed({ id: "u2", username: "ravi", passwordHash: "h", roles: [] });
    await service.upsert(input);
    const oldSession = await sessions.issue({ userId: "u1", displayName: "A", roles: [], grants: [] });
    await service.upsert({ ...input, userId: "u2" });
    expect(await repo.getGrants("u1")).toHaveLength(0);
    expect(await repo.getGrants("u2")).toHaveLength(1);
    expect(await sessions.resolve(oldSession.token)).toBeNull();
  });

  it("derives class_teacher grants without a subject", async () => {
    const { service, repo } = makeService();
    repo.seed({ id: "u1", username: "asha", passwordHash: "h", roles: [] });
    await service.upsert({
      userId: "u1",
      role: "class_teacher",
      org: { collegeId: "col-1", departmentId: "dep-1", classId: "cls-1" },
      sourceRef: "people:assignment:a2",
    });
    const grants = await repo.getGrants("u1");
    expect(grants[0]?.role).toBe("class_teacher");
    expect(grants[0]?.subjectId).toBeUndefined();
    expect(await repo.getRoles("u1")).toContain("class_teacher");
  });
});

describe("DerivedGrantsService.removeBySourceRef", () => {
  it("removes the grant, kills sessions, audits; false when absent", async () => {
    const { service, repo, sessions, audit } = makeService();
    repo.seed({ id: "u1", username: "asha", passwordHash: "h", roles: [] });
    await service.upsert(input);
    const session = await sessions.issue({ userId: "u1", displayName: "A", roles: [], grants: [] });

    expect(await service.removeBySourceRef(input.sourceRef)).toBe(true);
    expect(await repo.getGrants("u1")).toHaveLength(0);
    expect(await sessions.resolve(session.token)).toBeNull();
    expect(audit.actions()).toContain("identity.grant-derivation-removed");
    // Role membership survives removal (never auto-revoked).
    expect(await repo.getRoles("u1")).toContain("teacher");

    expect(await service.removeBySourceRef("people:assignment:ghost")).toBe(false);
  });
});

describe("DerivedGrantsService.listBySourcePrefix", () => {
  it("lists only derived grants under the prefix", async () => {
    const { service, repo } = makeService();
    repo.seed({
      id: "u1",
      username: "asha",
      passwordHash: "h",
      roles: ["hod"],
      grants: [
        { id: "manual-1", role: "hod", org: { collegeId: "col-1", departmentId: "dep-1" }, verified: true },
      ],
    });
    await service.upsert(input);
    const listed = await service.listBySourcePrefix("people:assignment:");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ sourceRef: "people:assignment:a1", userId: "u1" });
  });
});
