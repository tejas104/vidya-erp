import { describe, expect, it } from "vitest";
import { csvDocument, csvRow, escapeCsvCell, isFormulaInjection } from "./escape-csv";

/**
 * The CSV formula-injection proof (the #3 obligation). This file is the
 * security control; the review reads it whole. Coverage-gated to 100%.
 */

describe("isFormulaInjection", () => {
  it("flags every dangerous leader and nothing safe", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rx"]) {
      expect(isFormulaInjection(bad), bad).toBe(true);
    }
    for (const safe of ["", "Ravi", "1+1", "a=b", " lead", "10%"]) {
      expect(isFormulaInjection(safe), safe).toBe(false);
    }
  });
});

describe("escapeCsvCell", () => {
  it("neutralises formula leaders with a leading quote", () => {
    expect(escapeCsvCell("=cmd|'/c calc'!A1")).toBe(`'=cmd|'/c calc'!A1`);
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("-1")).toBe("'-1");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("neutralises AND rfc-quotes when the value also has a comma/quote/newline", () => {
    // A crafted name that is both a formula and contains a comma.
    expect(escapeCsvCell("=1,2")).toBe(`"'=1,2"`);
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("leaves safe values untouched and quotes only when structurally required", () => {
    expect(escapeCsvCell("Ravi Kumar")).toBe("Ravi Kumar");
    expect(escapeCsvCell("Kumar, Ravi")).toBe('"Kumar, Ravi"');
    expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("coerces numbers and null/undefined", () => {
    expect(escapeCsvCell(72)).toBe("72");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    // A negative number is a string starting with '-', so it is defused —
    // acceptable: the CSV shows '-2 as text (correctness over prettiness for
    // untyped cells; numeric columns are formatted with a % suffix upstream).
    expect(escapeCsvCell(-2)).toBe("'-2");
  });
});

describe("csvRow / csvDocument", () => {
  it("escapes every cell in a row", () => {
    expect(csvRow(["Ravi", "=evil", 90])).toBe("Ravi,'=evil,90");
  });

  it("joins rows with CRLF (RFC-4180)", () => {
    expect(csvDocument([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });

  it("a full document of hostile names stays inert", () => {
    const doc = csvDocument([
      ["Student", "Score"],
      ["=cmd()", 10],
      ["@evil,x", 20],
    ]);
    // No cell in the body begins with a bare formula leader after the header.
    for (const line of doc.split("\r\n").slice(1)) {
      const first = line[0]!;
      expect(["=", "+", "@"].includes(first)).toBe(false);
    }
  });
});
