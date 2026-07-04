import { describe, expect, it } from "vitest";
import { buildSessionCookie, clearSessionCookie, parseCookies } from "./cookies";

describe("parseCookies", () => {
  it("parses a cookie header into a map", () => {
    expect(parseCookies("a=1; vidya_session=tok-x; b=2")).toEqual({
      a: "1",
      vidya_session: "tok-x",
      b: "2",
    });
  });

  it("tolerates null, empty and malformed input", () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies("")).toEqual({});
    expect(parseCookies("just-garbage; =nameless; ok=1")).toEqual({ ok: "1" });
  });

  it("keeps values containing '='", () => {
    expect(parseCookies("t=abc=def")).toEqual({ t: "abc=def" });
  });
});

describe("buildSessionCookie", () => {
  it("sets the hardening attributes (ADR-0011)", () => {
    const cookie = buildSessionCookie({ name: "vidya_session", secure: true }, "tok", 3600);
    expect(cookie).toContain("vidya_session=tok");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).toContain("Secure");
  });

  it("omits Secure only when configured for plain-http local dev", () => {
    const cookie = buildSessionCookie({ name: "vidya_session", secure: false }, "tok", 60);
    expect(cookie).not.toContain("Secure");
  });

  it("clamps negative max-age to 0", () => {
    expect(buildSessionCookie({ name: "n", secure: true }, "t", -5)).toContain("Max-Age=0");
  });
});

describe("clearSessionCookie", () => {
  it("empties the value and expires immediately", () => {
    const cookie = clearSessionCookie({ name: "vidya_session", secure: true });
    expect(cookie).toContain("vidya_session=;");
    expect(cookie).toContain("Max-Age=0");
  });
});
