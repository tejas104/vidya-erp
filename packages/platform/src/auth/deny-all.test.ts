import { describe, expect, it } from "vitest";
import { DenyAllAccessPolicy, DenyAllAuthenticator } from "./deny-all";

describe("DenyAllAuthenticator", () => {
  it("refuses every request with a challenge", async () => {
    const decision = await new DenyAllAuthenticator().authenticate();
    expect(decision.authenticated).toBe(false);
    if (!decision.authenticated) {
      expect(decision.reason).toContain("Vidya #2");
      expect(decision.challenge).toContain("Bearer");
    }
  });
});

describe("DenyAllAccessPolicy", () => {
  it("grants nothing", async () => {
    const decision = await new DenyAllAccessPolicy().authorize();
    expect(decision.granted).toBe(false);
  });
});
