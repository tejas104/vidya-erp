import { describe, expect, it } from "vitest";
import { compareIsoDates, enumerateIsoDates, isValidIsoDate } from "./dates";

describe("isValidIsoDate", () => {
  it.each(["2026-06-15", "2028-02-29", "2000-02-29", "2026-01-01", "2026-12-31"])("accepts a real date %s", (date) => {
    expect(isValidIsoDate(date)).toBe(true);
  });

  it.each([
    "2026-02-30", // February never has 30 days
    "2027-02-29", // 2027 is not a leap year
    "2026-13-01", // month 13
    "2026-00-10", // month 0
    "2026-06-00", // day 0
    "2026-6-15", // not zero-padded
    "26-06-15", // 2-digit year
    "2026/06/15",
    "not-a-date",
    "",
  ])("rejects an invalid date %s", (date) => {
    expect(isValidIsoDate(date)).toBe(false);
  });
});

describe("compareIsoDates", () => {
  it("orders chronologically, including across a year boundary", () => {
    expect(compareIsoDates("2026-01-01", "2026-01-02")).toBeLessThan(0);
    expect(compareIsoDates("2026-12-31", "2027-01-01")).toBeLessThan(0);
    expect(compareIsoDates("2026-06-15", "2026-06-15")).toBe(0);
    expect(compareIsoDates("2026-06-16", "2026-06-15")).toBeGreaterThan(0);
  });
});

describe("enumerateIsoDates", () => {
  it("is inclusive of both endpoints", () => {
    expect(enumerateIsoDates("2026-06-15", "2026-06-17")).toEqual(["2026-06-15", "2026-06-16", "2026-06-17"]);
  });

  it("returns a single day when from equals to", () => {
    expect(enumerateIsoDates("2026-06-15", "2026-06-15")).toEqual(["2026-06-15"]);
  });

  it("rolls correctly across a leap day", () => {
    expect(enumerateIsoDates("2028-02-27", "2028-03-01")).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("rolls correctly across February in a non-leap year", () => {
    expect(enumerateIsoDates("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });

  it("rolls correctly across a year boundary", () => {
    expect(enumerateIsoDates("2026-12-30", "2027-01-01")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });
});
