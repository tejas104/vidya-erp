import { describe, expect, it } from "vitest";
import { problemResponse } from "./problem";

describe("problemResponse", () => {
  it("produces an RFC 9457 envelope with correlation id", async () => {
    const response = problemResponse({
      status: 401,
      title: "Authentication required",
      requestId: "req-1",
      headers: { "www-authenticate": 'Bearer realm="vidya"' },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    const body = await response.json();
    expect(body).toMatchObject({
      title: "Authentication required",
      status: 401,
      requestId: "req-1",
    });
  });

  it("carries validation issues when provided", async () => {
    const response = problemResponse({
      status: 400,
      title: "Invalid query parameters",
      requestId: "req-2",
      issues: [{ path: "limit", message: "must be a number" }],
    });
    const body = (await response.json()) as { issues: unknown };
    expect(body.issues).toEqual([{ path: "limit", message: "must be a number" }]);
  });
});
