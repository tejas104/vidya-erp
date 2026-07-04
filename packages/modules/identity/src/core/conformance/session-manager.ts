import { describe, expect, it } from "vitest";
import type { SessionData, SessionManager } from "../contracts";

/**
 * CONFORMANCE SUITE — SessionManager (Fable-authored acceptance harness for
 * the HUMAN-OWNED implementation). The harness creates managers with
 * suite-controlled TTL/idle windows so expiry is tested with real waits
 * against real Redis — run it in the integration project:
 *
 *   describeSessionManagerConformance("redis sessions", {
 *     create: (windows) => createSessionManager({ redis, session: windows }),
 *   });
 */
export interface SessionManagerConformanceHarness {
  create(windows: { ttlSeconds: number; idleSeconds: number }): Promise<SessionManager>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sampleData: SessionData = {
  userId: "user-1",
  displayName: "Asha Verma",
  roles: ["teacher"],
  grants: [
    {
      role: "teacher",
      org: { collegeId: "col-1", departmentId: "dep-sci", classId: "cls-10a" },
      subjectId: "sub-math",
    },
  ],
};

export function describeSessionManagerConformance(
  name: string,
  harness: SessionManagerConformanceHarness,
): void {
  describe(`SessionManager conformance: ${name}`, () => {
    it("round-trips the exact session snapshot", async () => {
      const sessions = await harness.create({ ttlSeconds: 60, idleSeconds: 60 });
      const issued = await sessions.issue(sampleData);
      expect(issued.token.length).toBeGreaterThanOrEqual(32);
      expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
      const record = await sessions.resolve(issued.token);
      expect(record).not.toBeNull();
      expect(record).toMatchObject({
        sessionId: issued.sessionId,
        userId: sampleData.userId,
        displayName: sampleData.displayName,
        roles: sampleData.roles,
        grants: sampleData.grants,
      });
    });

    it("issues unique, unguessable tokens and session ids", async () => {
      const sessions = await harness.create({ ttlSeconds: 60, idleSeconds: 60 });
      const first = await sessions.issue(sampleData);
      const second = await sessions.issue(sampleData);
      expect(first.token).not.toBe(second.token);
      expect(first.sessionId).not.toBe(second.sessionId);
    });

    it("rejects garbage and tampered tokens (null, never a throw)", async () => {
      const sessions = await harness.create({ ttlSeconds: 60, idleSeconds: 60 });
      const issued = await sessions.issue(sampleData);
      expect(await sessions.resolve("")).toBeNull();
      expect(await sessions.resolve("completely-made-up")).toBeNull();
      const flipped =
        issued.token.slice(0, -1) + (issued.token.endsWith("a") ? "b" : "a");
      expect(await sessions.resolve(flipped)).toBeNull();
    });

    it("invalidate() kills exactly that session", async () => {
      const sessions = await harness.create({ ttlSeconds: 60, idleSeconds: 60 });
      const first = await sessions.issue(sampleData);
      const second = await sessions.issue(sampleData);
      await sessions.invalidate(first.sessionId);
      expect(await sessions.resolve(first.token)).toBeNull();
      expect(await sessions.resolve(second.token)).not.toBeNull();
    });

    it("invalidateAllForUser() kills every session of that user and only that user", async () => {
      const sessions = await harness.create({ ttlSeconds: 60, idleSeconds: 60 });
      const a1 = await sessions.issue(sampleData);
      const a2 = await sessions.issue(sampleData);
      const other = await sessions.issue({ ...sampleData, userId: "user-2" });
      const count = await sessions.invalidateAllForUser(sampleData.userId);
      expect(count).toBe(2);
      expect(await sessions.resolve(a1.token)).toBeNull();
      expect(await sessions.resolve(a2.token)).toBeNull();
      expect(await sessions.resolve(other.token)).not.toBeNull();
    });

    it("expires sessions at the absolute TTL", async () => {
      const sessions = await harness.create({ ttlSeconds: 1, idleSeconds: 60 });
      const issued = await sessions.issue(sampleData);
      expect(await sessions.resolve(issued.token)).not.toBeNull();
      await sleep(1_300);
      expect(await sessions.resolve(issued.token)).toBeNull();
    });

    it("expires idle sessions, and resolving slides the idle window", async () => {
      const sessions = await harness.create({ ttlSeconds: 60, idleSeconds: 1 });
      const issued = await sessions.issue(sampleData);
      await sleep(600);
      expect(await sessions.resolve(issued.token)).not.toBeNull(); // slides
      await sleep(600);
      expect(await sessions.resolve(issued.token)).not.toBeNull(); // slid again
      await sleep(1_300);
      expect(await sessions.resolve(issued.token)).toBeNull(); // idle exceeded
    });

    it("never resolves a session past the absolute TTL even under activity", async () => {
      const sessions = await harness.create({ ttlSeconds: 2, idleSeconds: 1 });
      const issued = await sessions.issue(sampleData);
      await sleep(700);
      await sessions.resolve(issued.token);
      await sleep(700);
      await sessions.resolve(issued.token);
      await sleep(900); // total > 2s absolute
      expect(await sessions.resolve(issued.token)).toBeNull();
    });
  });
}
