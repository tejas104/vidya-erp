import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { ReportData } from "../report-data";
import { renderCredentialSheet } from "./credential-sheet";

/**
 * Proves the renderer produces a REAL, page-per-class PDF — not just
 * non-empty bytes. We don't add a PDF-parsing dependency (ADR-0009): pdfkit
 * writes an uncompressed object structure with FlateDecode-compressed
 * content streams, so `node:zlib` (stdlib) is enough to (a) read the page
 * count straight from the Pages-tree `/Count`, and (b) inflate each page's
 * own content stream and reconstruct its text from the hex-encoded show-text
 * operators, so we can assert WHICH page each class's credentials land on.
 */

function pageCount(buf: Buffer): number {
  const match = buf.toString("latin1").match(/\/Count (\d+)/);
  if (match === null) throw new Error("no /Count found — not a PDF page tree");
  return Number(match[1]);
}

/**
 * Inflates every object's stream and returns per-page reconstructed text, in
 * page order. Objects are read as `N 0 obj ... endobj` blocks with a
 * negative-lookahead body (`(?:(?!endobj)[\s\S])*?`) so a lazy `[\s\S]*?`
 * can't accidentally swallow a neighbouring object and mis-associate its
 * object number with the wrong stream — the naive `<<...>>\nstream` regex
 * does exactly that here, because the Resources dict between a Page object
 * and its Contents stream also ends in `>>`.
 */
function pageTexts(buf: Buffer): string[] {
  const raw = buf.toString("latin1");

  const streamsByObjNum = new Map<number, string>();
  const pageContentRefs: number[] = [];
  const objectRe = /(\d+) 0 obj\r?\n((?:(?!endobj)[\s\S])*?)endobj/g;
  for (const m of raw.matchAll(objectRe)) {
    const objNum = Number(m[1]);
    const body = m[2]!;
    const streamMatch = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (streamMatch !== null) {
      try {
        streamsByObjNum.set(objNum, inflateSync(Buffer.from(streamMatch[1]!, "latin1")).toString("latin1"));
      } catch {
        // Non-Flate stream (e.g. an embedded font) — irrelevant to page text.
      }
    }
    if (/\/Type \/Page\b/.test(body) && !/\/Type \/Pages\b/.test(body)) {
      const contentsMatch = body.match(/\/Contents (\d+) 0 R/);
      if (contentsMatch !== null) pageContentRefs.push(Number(contentsMatch[1]));
    }
  }

  const decodeHexShowOps = (streamText: string): string => {
    const hexTokens = streamText.match(/<([0-9A-Fa-f]+)>/g) ?? [];
    let out = "";
    for (const token of hexTokens) {
      const hex = token.slice(1, -1);
      for (let i = 0; i + 1 < hex.length; i += 2) {
        out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
    }
    return out;
  };

  return pageContentRefs.map((ref) => decodeHexShowOps(streamsByObjNum.get(ref) ?? ""));
}

function fixture(): ReportData {
  return {
    kind: "class-credentials",
    title: "Class credential sheet",
    subtitle: "Two classes",
    academicYear: "2026-27",
    generatedFor: "Admin User",
    generatedAt: "2026-08-06T00:00:00.000Z",
    stats: [],
    tables: [
      {
        caption: "FY BSc Computer Science, Section A",
        columns: ["Roll no", "Name", "Username", "Temporary password"],
        rows: [["1", "Ravi Kumar", "ravi.kumar", "Xk9mQ2vLp"]],
      },
      {
        caption: "FY BSc Computer Science, Section B",
        columns: ["Roll no", "Name", "Username", "Temporary password"],
        rows: [["1", "Anita Rao", "anita.rao", "Zt7nR4wSq"]],
      },
    ],
    notes: ["Contains plaintext temporary passwords — hand each row's slip to its student and discard this sheet promptly."],
    rowCount: 2,
  };
}

describe("renderCredentialSheet", () => {
  it("returns a non-empty, real PDF (%PDF header, non-trivial size)", async () => {
    const buf = await renderCredentialSheet(fixture());
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("emits exactly one page per class", async () => {
    const buf = await renderCredentialSheet(fixture());
    expect(pageCount(buf)).toBe(2);
  });

  it("puts each class's roll no / name / username / password on ITS OWN page, not the other's", async () => {
    const buf = await renderCredentialSheet(fixture());
    const [page1, page2] = pageTexts(buf);
    expect(page1).toBeDefined();
    expect(page2).toBeDefined();

    for (const expected of ["FY BSc Computer Science, Section A", "Ravi Kumar", "ravi.kumar", "Xk9mQ2vLp", "Roll no", "Temporary password"]) {
      expect(page1).toContain(expected);
    }
    expect(page1).not.toContain("Anita Rao");
    expect(page1).not.toContain("Zt7nR4wSq");

    for (const expected of ["FY BSc Computer Science, Section B", "Anita Rao", "anita.rao", "Zt7nR4wSq"]) {
      expect(page2).toContain(expected);
    }
    expect(page2).not.toContain("Ravi Kumar");
    expect(page2).not.toContain("Xk9mQ2vLp");
  });

  it("prints the first-login instructions and the sensitivity note on every page", async () => {
    const buf = await renderCredentialSheet(fixture());
    const [page1, page2] = pageTexts(buf);
    for (const page of [page1, page2]) {
      expect(page).toContain("First login");
      expect(page).toContain("plaintext temporary passwords");
    }
  });

  it("prints a placeholder row for a class with no credentials issued", async () => {
    const data = fixture();
    const buf = await renderCredentialSheet({ ...data, tables: [{ ...data.tables[0]!, rows: [] }] });
    const [page1] = pageTexts(buf);
    expect(page1).toContain("No credentials issued for this class.");
  });
});
