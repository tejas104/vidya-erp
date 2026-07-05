import { describe, expect, it } from "vitest";
import type { OrgDirectory } from "@vidya/platform";
import { GrantVerificationService } from "./grant-verification";
import { FakeUsersRepo } from "../../test-support/fakes";

function directory(validPaths: string[], validSubjects: string[]): OrgDirectory {
  return {
    verifyOrgPath: async (path) => {
      const key = [path.collegeId, path.departmentId, path.classId, path.sectionId]
        .filter((part) => part !== undefined)
        .join("/");
      return validPaths.includes(key)
        ? { valid: true }
        : { valid: false, reason: `no such org path ${key}` };
    },
    verifySubjectId: async (subjectId) => validSubjects.includes(subjectId),
  };
}

describe("GrantVerificationService", () => {
  it("returns null when no OrgDirectory is wired", async () => {
    const service = new GrantVerificationService(new FakeUsersRepo(), () => null);
    expect(await service.verifyUnverified()).toBeNull();
  });

  it("flips resolvable grants and reports unresolvable ones without deleting", async () => {
    const repo = new FakeUsersRepo();
    repo.seed({
      id: "u1",
      username: "asha",
      passwordHash: "h",
      roles: ["hod", "teacher"],
      grants: [
        { id: "g-good", role: "hod", org: { collegeId: "col-1", departmentId: "dep-1" }, verified: false },
        { id: "g-bad-path", role: "hod", org: { collegeId: "col-1", departmentId: "dep-typo" }, verified: false },
        {
          id: "g-bad-subject",
          role: "teacher",
          org: { collegeId: "col-1", departmentId: "dep-1", classId: "cls-1" },
          subjectId: "sub-typo",
          verified: false,
        },
        { id: "g-already", role: "hod", org: { collegeId: "col-1", departmentId: "dep-1" }, verified: true },
      ],
    });
    const service = new GrantVerificationService(
      repo,
      () => directory(["col-1/dep-1", "col-1/dep-1/cls-1"], ["sub-1"]),
    );
    repo.seed({
      id: "u2",
      username: "ravi",
      passwordHash: "h",
      roles: ["teacher"],
      grants: [
        {
          id: "g-good-subject",
          role: "teacher",
          org: { collegeId: "col-1", departmentId: "dep-1", classId: "cls-1" },
          subjectId: "sub-1",
          verified: false,
        },
      ],
    });
    const result = await service.verifyUnverified();
    expect(result).not.toBeNull();
    expect(result?.verified).toBe(2);
    expect(result?.unresolved.map((entry) => entry.grantId).sort()).toEqual([
      "g-bad-path",
      "g-bad-subject",
    ]);
    const grants = await repo.getGrants("u1");
    expect(grants.find((grant) => grant.id === "g-good")?.verified).toBe(true);
    expect(grants.find((grant) => grant.id === "g-bad-path")?.verified).toBe(false);
    expect(grants).toHaveLength(4); // nothing deleted
  });
});
