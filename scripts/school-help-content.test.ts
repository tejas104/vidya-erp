import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileDoc } from "./compile-help";

const schoolHelpDir = path.join(process.cwd(), "content", "help", "school");

const requiredArticles = {
  terms: ["Administrators", "Before you start", "Create an academic term", "Configure assessment types", "Close or reopen a term", "Closing a term makes its assessment marks read-only", "Reopening reason"],
  marks: ["Only a teacher assigned", "Before you start", "Create an assessment", "Enter or correct marks", "Closed terms", "reopen the term with a reason"],
  attendance: ["Subject teachers", "Before you start", "Record a section", "Save attendance"],
  coursework: ["assigned teaching subject", "Before you start", "Create and manage assignments", "Share study material"],
} as const;

describe("school help content", () => {
  it("covers the implemented school workflows with roles, prerequisites, steps, results, and recovery", async () => {
    for (const [slug, requiredText] of Object.entries(requiredArticles)) {
      const source = await readFile(path.join(schoolHelpDir, `${slug}.md`), "utf8");
      for (const text of requiredText) expect(source).toContain(text);
      const compiled = compileDoc(source);
      expect(compiled.title).not.toBe("Untitled");
      expect(compiled.html).toContain("<ol>");
      expect(compiled.html).toContain("<h2>");
    }
  });

  it("does not claim unavailable school features", async () => {
    const sources = await Promise.all(Object.keys(requiredArticles).map((slug) => readFile(path.join(schoolHelpDir, `${slug}.md`), "utf8")));
    const content = sources.join("\n").toLowerCase();
    for (const unsupportedClaim of ["parent login", "report publication", "online payment", "promotion", "government integration"]) {
      expect(content).not.toContain(unsupportedClaim);
    }
  });
});
