import { describe, expect, it, vi } from "vitest";
import { createIdentityCore } from "@vidya/module-identity";
import type { Principal, RedisClient, Role } from "@vidya/platform";
import { assessmentTypesInputSchema } from "./assessment-types";
import { createAssessmentTypesHandlers } from "./assessment-types-handlers";
import type { SchTermRow } from "./db/schema";
import type { TermsRepo } from "./repo";
import { schoolAcademicsModuleDefinition } from "./definition";

const { scopeChecker } = createIdentityCore({ redis: {} as RedisClient, session: { ttlHours: 12, idleMinutes: 30 } });
const term = { id: "t1", collegeId: "s1", departmentId: "d1", status: "open" } as SchTermRow;
const config = { types: [{ name: "Unit test", weight: 40 }, { name: "Annual", weight: 60 }] };

function setup(role: Role = "admin", collegeId = "s1", status = "open") {
  const caller: Principal = { kind: "user", id: "u1", displayName: "Test user", scopes: [], sessionId: "session-test", roles: [role], grants: [{ role, org: { collegeId } }] };
  const terms = { get: vi.fn(async () => ({ ...term, status })) } as unknown as TermsRepo;
  const types = { list: vi.fn(async () => []), replace: vi.fn(async () => ({ before: [], types: config.types.map((type, index) => ({ ...type, id: `a${index}`, termId: term.id })) })) };
  const handlers = createAssessmentTypesHandlers({ terms, types, scopeChecker });
  const call = (write: boolean, body: unknown = config) => handlers[write ? "school-academics.types-set" : "school-academics.types-list"]!({ principal: caller, request: { params: { termId: term.id }, body } } as never);
  return { types, terms, call };
}

describe("school assessment configuration", () => {
  it.each([
    { types: [{ name: "Test", weight: 90 }] },
    { types: [{ name: "Test", weight: 40 }, { name: " test ", weight: 60 }] },
    { types: [{ name: "Test", weight: 100.5 }] },
    { types: [{ name: "Test", weight: 0 }, { name: "Exam", weight: 100 }] },
    { types: [] },
    { types: [{ id: "a", name: "Test", weight: 50 }, { id: "a", name: "Exam", weight: 50 }] },
  ])("rejects invalid distributions %#", (input) => {
    expect(assessmentTypesInputSchema.safeParse(input).success).toBe(false);
  });

  it("saves a complete distribution with before/after audit evidence", async () => {
    const { call, types } = setup();
    const response = await call(true);
    expect(response.status).toBe(200);
    expect(types.replace).toHaveBeenCalledWith("t1", config.types);
    expect(response.audit).toMatchObject({ resourceId: "t1", details: { before: [], after: expect.any(Array) } });
  });

  it.each([false, true])("denies a foreign school's administrator (write=%s)", async (write) => {
    const { call, types } = setup("admin", "s2");
    expect((await call(write)).status).toBe(403);
    expect(types.list).not.toHaveBeenCalled();
    expect(types.replace).not.toHaveBeenCalled();
  });

  it("allows a principal to read but not change the configuration", async () => {
    const { call, types } = setup("principal");
    expect((await call(false)).status).toBe(200);
    expect((await call(true)).status).toBe(403);
    expect(types.replace).not.toHaveBeenCalled();
  });

  it("refuses changes to closed terms without touching storage", async () => {
    const { call, types } = setup("admin", "s1", "closed");
    expect((await call(true)).status).toBe(409);
    expect(types.replace).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing term before checking access", async () => {
    const { call, terms } = setup("admin", "s2");
    vi.mocked(terms.get).mockResolvedValue(null);
    expect((await call(true)).status).toBe(404);
  });

  it("validates weights at the handler boundary too", async () => {
    const { call, types } = setup();
    expect((await call(true, { types: [{ name: "Test", weight: 10 }] })).status).toBe(422);
    expect(types.replace).not.toHaveBeenCalled();
  });

  it("rejects impossible dates in the term contract", () => {
    const schema = schoolAcademicsModuleDefinition.routes.find((route) => route.id === "school-academics.create")!.request!.body!;
    expect(schema.safeParse({ collegeId: "s1", name: "Term", academicYear: "2026-27", startsOn: "2026-02-30", endsOn: "2026-09-30" }).success).toBe(false);
  });
});
