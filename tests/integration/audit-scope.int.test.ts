import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

let stack: Stack;
let adminCookie: string;
let collegeId: string;
const action = `integration.audit-scope.${randomUUID()}`;

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  adminCookie = bootstrap.adminCookie;
  collegeId = bootstrap.collegeId;
  await stack.system.service.audit.record({ org: { collegeId }, module: "system", action, actorType: "system", actorId: null, resourceType: "probe", resourceId: "own", requestId: null, details: { marker: "own" } });
  await stack.system.service.audit.record({ org: { collegeId: `foreign-${collegeId}` }, module: "system", action, actorType: "system", actorId: null, resourceType: "probe", resourceId: "foreign", requestId: null, details: { marker: "foreign" } });
  await stack.system.service.audit.record({ module: "system", action, actorType: "system", actorId: null, resourceType: "probe", resourceId: "unscoped", requestId: null, details: { marker: "unscoped" } });
});
afterAll(async () => { await stack?.close(); });

describe("institution audit-log containment", () => {
  it("requires authentication", async () => {
    expect((await stack.call("system.audit-log", { query: { action, limit: "50" } })).status).toBe(401);
  });

  it("returns only events inside the administrator's shared-checker scope", async () => {
    const response = await stack.call("system.audit-log", { cookie: adminCookie, query: { action, limit: "50" } });
    expect(response.status).toBe(200);
    const body = await response.json() as { events: { resourceId: string }[] };
    expect(body.events.map((event) => event.resourceId)).toEqual(["own"]);
  });
});
