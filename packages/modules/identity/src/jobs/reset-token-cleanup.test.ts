import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { JobContext } from "@vidya/platform";
import { createResetCleanupProcessor } from "./reset-token-cleanup";
import { FakeResetTokensRepo, RecordingAudit } from "../../test-support/fakes";

const jobContext: JobContext = {
  logger: pino({ level: "silent" }),
  jobId: "job-1",
  attempt: 1,
};

describe("reset-token-cleanup job", () => {
  it("deletes stale tokens and audits the purge", async () => {
    const repo = new FakeResetTokensRepo();
    const audit = new RecordingAudit();
    await repo.create({
      userId: "u1",
      tokenHash: "h1",
      expiresAt: new Date(Date.now() - 1000),
      createdBy: "admin-1",
    });
    await repo.create({
      userId: "u1",
      tokenHash: "h2",
      expiresAt: new Date(Date.now() + 60_000),
      createdBy: "admin-1",
    });
    const processor = createResetCleanupProcessor(repo, audit);
    await processor({ source: "test" }, jobContext);
    expect(repo.rows).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: "identity.reset-tokens-purged",
      actorType: "system",
      details: expect.objectContaining({ removed: 1 }),
    });
  });

  it("does not audit a no-op sweep", async () => {
    const repo = new FakeResetTokensRepo();
    const audit = new RecordingAudit();
    const processor = createResetCleanupProcessor(repo, audit);
    await processor({ source: "test" }, jobContext);
    expect(audit.events).toHaveLength(0);
  });

  it("rejects malformed payloads", async () => {
    const processor = createResetCleanupProcessor(new FakeResetTokensRepo(), new RecordingAudit());
    await expect(processor({ source: "" }, jobContext)).rejects.toThrow();
  });
});
