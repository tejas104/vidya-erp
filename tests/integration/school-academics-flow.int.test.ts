import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

let stack: Stack;
let cookie: string;
let collegeId: string;
let termId: string;
const runId = randomUUID().slice(0, 8);
const types = [{ name: "Unit tests", weight: 40 }, { name: "Annual exam", weight: 60 }];

beforeAll(async () => {
  stack = buildStack("school");
  const bootstrap = await stack.bootstrap();
  cookie = bootstrap.adminCookie;
  collegeId = bootstrap.collegeId;
  const response = await stack.call("school-academics.create", { cookie, body: { collegeId, name: `Integration term ${runId}`, academicYear: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" } });
  expect(response.status).toBe(201);
  termId = ((await response.json()) as { id: string }).id;
});
afterAll(async () => { await stack?.close(); });

describe("School term assessment configuration through the authenticated route pipeline", () => {
  it("requires login", async () => {
    const response = await stack.call("school-academics.types-list", { params: { termId } });
    expect(response.status).toBe(401);
  });

  it("saves the full distribution, persists its identifiers, and writes the audit trail", async () => {
    const response = await stack.call("school-academics.types-set", { cookie, params: { termId }, body: { types } });
    expect(response.status).toBe(200);
    const saved = await response.json() as { types: { id: string; name: string; weight: number }[] };
    expect(saved.types).toHaveLength(2);
    const read = await stack.call("school-academics.types-list", { cookie, params: { termId } });
    expect(read.status).toBe(200);
    const rows = (await read.json()) as typeof saved;
    expect(rows.types.map((type) => type.id).sort()).toEqual(saved.types.map((type) => type.id).sort());
    const audit = await stack.system.service.readAuditEventsForResource("term", termId, 10);
    expect(audit.some((event) => event.action === "school-academics.types-configured")).toBe(true);
    const renamed = saved.types.map((type) => ({ ...type, name: `${type.name} revised` }));
    const update = await stack.call("school-academics.types-set", { cookie, params: { termId }, body: { types: renamed } });
    expect(update.status).toBe(200);
    const updated = (await update.json()) as typeof saved;
    expect(updated.types.map((type) => type.id)).toEqual(saved.types.map((type) => type.id));
  });

  it("rejects invalid totals without changing persisted rows", async () => {
    const response = await stack.call("school-academics.types-set", { cookie, params: { termId }, body: { types: [{ name: "Test", weight: 25 }] } });
    expect(response.status).toBe(400);
    const { rows } = await stack.pool.query("SELECT sum(weight)::int AS total FROM sca_assessment_types WHERE term_id = $1", [termId]);
    expect(rows[0].total).toBe(100);
    // The deferred DB constraint also guards callers outside the HTTP layer.
    await expect(stack.pool.query("UPDATE sca_assessment_types SET weight = 1 WHERE term_id = $1", [termId])).rejects.toMatchObject({ code: "23514" });
  });

  it("serializes concurrent closure and refuses configuration edits until audited reopening", async () => {
    const close = () => stack.call("school-academics.close", { cookie, params: { termId }, body: {} });
    const responses = await Promise.all([close(), close()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const rejected = await stack.call("school-academics.types-set", { cookie, params: { termId }, body: { types } });
    expect(rejected.status).toBe(409);
    await expect(stack.pool.query("UPDATE sca_assessment_types SET name = name || ' closed' WHERE term_id = $1", [termId])).rejects.toMatchObject({ code: "23514" });
    const emptyReason = await stack.call("school-academics.reopen", { cookie, params: { termId }, body: { reason: " " } });
    expect(emptyReason.status).toBe(400);
    const reopened = await stack.call("school-academics.reopen", { cookie, params: { termId }, body: { reason: "Academic committee approved revised weights" } });
    expect(reopened.status).toBe(200);
    const saved = await stack.call("school-academics.types-set", { cookie, params: { termId }, body: { types } });
    expect(saved.status).toBe(200);
  });
});
