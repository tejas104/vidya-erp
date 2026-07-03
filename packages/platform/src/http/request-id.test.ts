import { describe, expect, it } from "vitest";
import { resolveRequestId } from "./request-id";

describe("resolveRequestId", () => {
  it("propagates a well-formed caller id", () => {
    const headers = new Headers({ "x-request-id": "abc-123.DEF_456" });
    expect(resolveRequestId(headers)).toBe("abc-123.DEF_456");
  });

  it("replaces a missing id with a UUID", () => {
    const id = resolveRequestId(new Headers());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("replaces an id containing unsafe characters (log injection)", () => {
    const headers = new Headers({ "x-request-id": "evil	id{}" });
    const id = resolveRequestId(headers);
    expect(id).not.toContain("evil");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("replaces an oversized id", () => {
    const headers = new Headers({ "x-request-id": "a".repeat(200) });
    expect(resolveRequestId(headers)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
