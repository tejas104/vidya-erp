import { describe, expect, it } from "vitest";
import {
  GuardianService,
  InvitationRefusedError,
  generateInvitationCode,
  hashInvitationCode,
  initialRelationshipState,
  type StudentBrief,
} from "./service";
import { InvitationNotClaimableError, type GuardiansRepo, type GuardianRow, type InvitationRow, type RelationshipRow } from "./repo";

/** In-memory GuardiansRepo mirroring the Drizzle one's contract (the real
 *  one is exercised against Postgres by the integration suite). */
function memoryRepo(): GuardiansRepo & { guardians: GuardianRow[]; relationships: RelationshipRow[] } {
  const invitations: InvitationRow[] = [];
  const guardians: GuardianRow[] = [];
  const relationships: RelationshipRow[] = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}_${++seq}`;
  return {
    guardians,
    relationships,
    async createInvitation(input) {
      const row: InvitationRow = { id: id("gin"), status: "pending", activatedRelationshipId: null, createdAt: new Date(), updatedAt: new Date(), ...input };
      invitations.push(row);
      return row;
    },
    async revokePendingFor(studentId, contactValue) {
      let n = 0;
      for (const row of invitations) {
        if (row.studentId === studentId && row.contactValue === contactValue && row.status === "pending") {
          row.status = "revoked";
          n += 1;
        }
      }
      return n;
    },
    async findInvitationByCodeHash(codeHash) {
      return invitations.find((row) => row.codeHash === codeHash) ?? null;
    },
    async pendingInvitationsFor(studentId, now) {
      return invitations.filter((row) => row.studentId === studentId && row.status === "pending" && row.expiresAt > now);
    },
    async countLiveRelationships(studentId) {
      return relationships.filter((row) => row.studentId === studentId && ["pending", "active", "restricted"].includes(row.status)).length;
    },
    async relationshipsForStudent(studentId) {
      return relationships
        .filter((row) => row.studentId === studentId)
        .map((row) => ({ ...row, guardianName: guardians.find((g) => g.id === row.guardianId)!.fullName }));
    },
    async relationshipsForGuardian(guardianId) {
      return relationships.filter((row) => row.guardianId === guardianId);
    },
    async getRelationship(rid) {
      return relationships.find((row) => row.id === rid) ?? null;
    },
    async setRelationshipState(rid, patch) {
      const row = relationships.find((candidate) => candidate.id === rid);
      if (row === undefined) return null;
      row.status = patch.status;
      if (patch.verificationState !== undefined) row.verificationState = patch.verificationState;
      row.statusReason = patch.reason;
      row.statusChangedBy = patch.changedBy;
      return row;
    },
    async guardianByIdentityUser(identityUserId) {
      return guardians.find((row) => row.identityUserId === identityUserId) ?? null;
    },
    async claimInvitation({ invitationId, now, guardian, relationship }) {
      const invitation = invitations.find((row) => row.id === invitationId)!;
      if (invitation.status !== "pending" || invitation.expiresAt <= now) throw new InvitationNotClaimableError();
      invitation.status = "activated";
      let guardianId: string;
      if ("id" in guardian) {
        guardianId = guardian.id;
      } else {
        guardianId = id("grd");
        guardians.push({ id: guardianId, status: "active", createdAt: now, updatedAt: now, ...guardian });
      }
      const values = {
        collegeId: relationship.collegeId,
        relationshipType: relationship.relationshipType,
        verificationState: relationship.verificationState,
        status: relationship.status,
        grantedCategories: [...relationship.grantedCategories],
        isPrimaryContact: relationship.isPrimaryContact,
        restrictions: [],
        validFrom: now,
        validUntil: null,
        historicalAccessUntil: null,
        statusReason: null,
        statusChangedBy: null,
        updatedAt: now,
      };
      let row = relationships.find((r) => r.guardianId === guardianId && r.studentId === relationship.studentId);
      if (row === undefined) {
        row = { id: id("sgr"), guardianId, studentId: relationship.studentId, createdAt: now, ...values };
        relationships.push(row);
      } else {
        Object.assign(row, values);
      }
      invitation.activatedRelationshipId = row.id;
      return { guardianId, relationship: row };
    },
  };
}

const PUPIL: StudentBrief = { studentId: "stu-1", collegeId: "col-1", fullName: "Asha Rao", admissionNo: "A-001" };
const OTHER_PUPIL: StudentBrief = { studentId: "stu-2", collegeId: "col-1", fullName: "Dev Rao", admissionNo: "A-002" };

function setup() {
  const repo = memoryRepo();
  let clock = new Date("2026-09-23T09:00:00Z");
  let lookups = 0;
  let accounts = 0;
  const service = new GuardianService({
    repo,
    student: async (studentId) => {
      lookups += 1;
      return [PUPIL, OTHER_PUPIL].find((s) => s.studentId === studentId) ?? null;
    },
    accounts: {
      createGuardianAccount: async (input) => ({ userId: `usr-${++accounts}`, username: input.username }),
    },
    selfAttestedLimit: 2,
    now: () => clock,
  });
  const issue = (overrides: Partial<Parameters<GuardianService["issueInvitation"]>[0]> = {}) =>
    service.issueInvitation({
      student: PUPIL,
      guardianName: "Meera Rao",
      relationshipType: "parent",
      contactMethod: "sms",
      contactValue: `+91-9000000${++accounts}`,
      staffVerified: false,
      issuedBy: "admin-1",
      ...overrides,
    });
  const activate = (code: string, username = `parent${Math.random().toString(36).slice(2, 8)}`) =>
    service.activate({ code, username, password: "a-long-chosen-passphrase", fullName: "Meera Rao" });
  return {
    repo,
    service,
    issue,
    activate,
    advance: (hours: number) => (clock = new Date(clock.getTime() + hours * 3_600_000)),
    lookups: () => lookups,
  };
}

describe("initialRelationshipState (ADR-0027 Decision 5)", () => {
  it.each([
    ["parent", false, 0, "active", "self-attested"],
    ["parent", false, 1, "active", "self-attested"],
    ["parent", false, 2, "pending", "self-attested"], // third adult waits for staff
    ["parent", true, 2, "active", "staff-verified"],
    ["other-authorized-contact", false, 0, "pending", "self-attested"], // never on self-attestation
    ["other-authorized-contact", true, 0, "active", "staff-verified"],
  ] as const)("%s, staffVerified=%s, %i already linked → %s / %s", (type, staffVerified, live, status, verification) => {
    expect(initialRelationshipState({ type, staffVerified, liveRelationships: live, selfAttestedLimit: 2 })).toEqual({
      status,
      verificationState: verification,
    });
  });

  it("honours a school's tighter configuration (limit 0: every adult is staff-verified)", () => {
    expect(initialRelationshipState({ type: "parent", staffVerified: false, liveRelationships: 0, selfAttestedLimit: 0 }).status).toBe("pending");
  });
});

describe("invitation codes", () => {
  it("are 20 unambiguous characters in groups of five", () => {
    expect(generateInvitationCode()).toMatch(/^[A-HJKMNP-TV-Z0-9]{5}(-[A-HJKMNP-TV-Z0-9]{5}){3}$/);
  });

  it("hash identically however the guardian types them", () => {
    expect(hashInvitationCode("abcde-fghjk mnpqr")).toBe(hashInvitationCode("ABCDEFGHJKMNPQR"));
  });
});

describe("GuardianService lifecycle", () => {
  it("issue → activate gives a parent read access to their own child, and only them", async () => {
    const { service, issue, activate } = setup();
    const { code, invitation } = await issue();
    expect(invitation.codeHash).not.toContain(code.replace(/-/g, ""));
    const activated = await activate(code);
    expect(activated.relationship).toMatchObject({ status: "active", verificationState: "self-attested", isPrimaryContact: true });

    const own = await service.access(activated.userId, "read", PUPIL.studentId, "marks");
    expect(own.decision).toMatchObject({ granted: true, reason: "granted:active-relationship" });
    expect(own.student?.fullName).toBe("Asha Rao");

    const other = await service.access(activated.userId, "read", OTHER_PUPIL.studentId, "attendance");
    expect(other).toEqual({ decision: { granted: false, reason: "denied:no-relationship" }, student: null });
  });

  it("never looks up a pupil the guardian has no relationship with (no existence oracle)", async () => {
    const { service, issue, activate, lookups } = setup();
    const activated = await activate((await issue()).code);
    const before = lookups();
    await service.access(activated.userId, "read", "stu-does-not-exist", "attendance");
    await service.access(activated.userId, "read", OTHER_PUPIL.studentId, "attendance");
    expect(lookups()).toBe(before);
  });

  it("refuses export and bulk reads even on an active relationship", async () => {
    const { service, issue, activate } = setup();
    const activated = await activate((await issue()).code);
    expect((await service.access(activated.userId, "export", PUPIL.studentId, "marks")).decision.granted).toBe(false);
    expect((await service.access(activated.userId, "bulk-read", PUPIL.studentId, "marks")).decision.granted).toBe(false);
  });

  it("a code works once", async () => {
    const { issue, activate } = setup();
    const { code } = await issue();
    await activate(code);
    await expect(activate(code)).rejects.toMatchObject({ reason: "denied:already-activated" });
  });

  it("an unknown code is refused without revealing anything", async () => {
    const { activate } = setup();
    await expect(activate("AAAAA-BBBBB-CCCCC-DDDDD")).rejects.toBeInstanceOf(InvitationRefusedError);
  });

  it("expires after 72 hours", async () => {
    const { issue, activate, advance } = setup();
    const { code } = await issue();
    advance(72.01);
    await expect(activate(code)).rejects.toMatchObject({ reason: "denied:expired" });
  });

  it("re-issuing to the same contact invalidates the earlier code", async () => {
    const { issue, activate } = setup();
    const first = await issue({ contactValue: "+91-9876543210" });
    const second = await issue({ contactValue: "+91-9876543210" });
    expect(second.revokedPrior).toBe(1);
    await expect(activate(first.code)).rejects.toMatchObject({ reason: "denied:revoked" });
    await expect(activate(second.code)).resolves.toBeDefined();
  });

  it("the third adult waits for staff verification, then gets access", async () => {
    const { service, issue, activate } = setup();
    await activate((await issue()).code);
    await activate((await issue()).code);
    const third = await activate((await issue()).code);
    expect(third.relationship.status).toBe("pending");
    expect((await service.access(third.userId, "read", PUPIL.studentId, "attendance")).decision.reason).toBe("denied:relationship-pending");

    await service.verify(third.relationship, "admin-1");
    expect((await service.access(third.userId, "read", PUPIL.studentId, "attendance")).decision.granted).toBe(true);
  });

  it("an other-authorized-contact sees attendance but never marks or fees", async () => {
    const { service, issue, activate } = setup();
    const contact = await activate((await issue({ relationshipType: "other-authorized-contact", staffVerified: true })).code);
    expect(contact.relationship.status).toBe("active");
    expect((await service.access(contact.userId, "read", PUPIL.studentId, "attendance")).decision.granted).toBe(true);
    expect((await service.access(contact.userId, "read", PUPIL.studentId, "marks")).decision.reason).toBe("denied:category-not-granted");
    expect((await service.access(contact.userId, "read", PUPIL.studentId, "fees")).decision.reason).toBe("denied:category-not-granted");
  });

  it("revocation takes effect on the very next request, for that child only", async () => {
    const { service, issue, activate } = setup();
    const parent = await activate((await issue()).code);
    await service.redeem({ code: (await issue({ student: OTHER_PUPIL })).code, identityUserId: parent.userId });

    await service.revoke(parent.relationship, "court order on file", "admin-1");
    expect((await service.access(parent.userId, "read", PUPIL.studentId, "attendance")).decision.reason).toBe("denied:relationship-revoked");
    expect((await service.access(parent.userId, "read", OTHER_PUPIL.studentId, "attendance")).decision.granted).toBe(true);
    expect((await service.children(parent.userId)).map((c) => c.studentId)).toEqual([OTHER_PUPIL.studentId]);
  });

  it("a suspended guardian loses every child at once", async () => {
    const { service, repo, issue, activate } = setup();
    const parent = await activate((await issue()).code);
    repo.guardians[0]!.status = "suspended";
    expect((await service.access(parent.userId, "read", PUPIL.studentId, "attendance")).decision.granted).toBe(false);
    expect(await service.children(parent.userId)).toEqual([]);
  });

  it("a relationship past its validUntil is expired whatever its stored status", async () => {
    const { service, repo, issue, activate } = setup();
    const parent = await activate((await issue()).code);
    repo.relationships[0]!.validUntil = new Date("2026-09-01T00:00:00Z");
    expect((await service.access(parent.userId, "read", PUPIL.studentId, "attendance")).decision.reason).toBe("denied:relationship-expired");
  });

  it("redeem refuses a caller who is not a guardian", async () => {
    const { service, issue } = setup();
    await expect(service.redeem({ code: (await issue()).code, identityUserId: "staff-user" })).rejects.toBeInstanceOf(InvitationRefusedError);
  });
});
