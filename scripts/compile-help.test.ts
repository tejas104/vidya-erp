import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileDoc, compileHelp } from "./compile-help";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHelpFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vidya-help-"));
  temporaryDirectories.push(root);
  const helpRoot = path.join(root, "help");
  const appRoutesDir = path.join(root, "app", "(app)");
  await Promise.all([
    mkdir(path.join(helpRoot, "college"), { recursive: true }),
    mkdir(path.join(helpRoot, "school"), { recursive: true }),
    mkdir(path.join(appRoutesDir, "manage", "shared"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(helpRoot, "college", "shared.md"), "# College guide\n\nCollege content", "utf8"),
    writeFile(path.join(helpRoot, "school", "shared.md"), "# School guide\n\nSchool content", "utf8"),
    writeFile(path.join(appRoutesDir, "manage", "shared", "page.tsx"), "export default function Page() { return null; }", "utf8"),
  ]);
  return { root, helpRoot, appRoutesDir };
}

// Regression coverage for the compiler's escaping/markdown-subset logic
// (escapeHtml/parseBlocks/renderBlocks via the compileDoc entry point).
// "A doc can never inject markup" is the whole point of this file, so every
// block type that renders user-authored text gets an adversarial raw-HTML
// case here.
describe("compileDoc", () => {
  it("escapes raw HTML in an h1 heading (also used as the plain-string title)", () => {
    const { title, html } = compileDoc("# <script>alert(1)</script>");
    expect(title).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>");
    expect(html).not.toContain("<script>");
  });

  it("escapes raw HTML in an h2 heading", () => {
    const { html } = compileDoc("## <img src=x onerror=alert(1)>");
    expect(html).toContain("<h2>&lt;img src=x onerror=alert(1)&gt;</h2>");
    expect(html).not.toContain("<img");
  });

  it("escapes raw HTML in a list item", () => {
    const { html } = compileDoc("- <b>bold html</b> in a list item");
    expect(html).toContain("<li>&lt;b&gt;bold html&lt;/b&gt; in a list item</li>");
    expect(html).not.toContain("<b>bold html</b>");
  });

  it("escapes raw HTML inside bold markup", () => {
    const { html } = compileDoc("**<script>evil()</script>**");
    expect(html).toContain("<strong>&lt;script&gt;evil()&lt;/script&gt;</strong>");
    expect(html).not.toContain("<script>evil");
  });

  it("escapes raw HTML inside inline code", () => {
    const { html } = compileDoc("Run `<script>evil()</script>` here");
    expect(html).toContain("<code>&lt;script&gt;evil()&lt;/script&gt;</code>");
    expect(html).not.toContain("<script>evil");
  });

  it("renders a > screenshot placeholder as a blockquote, escaping its content", () => {
    // Regression test for a real bug found during manual review: escaping
    // a whole line before checking for the "> " prefix turns it into
    // "&gt; ", so the prefix check never matches and the line silently
    // falls through to a plain <p> instead of a blockquote. Block
    // structure must be detected on the RAW line; only the content is
    // escaped afterward.
    const { html } = compileDoc("> screenshot: the <b>evil</b> grid");
    expect(html).toBe(
      '<blockquote class="help-screenshot">screenshot: the &lt;b&gt;evil&lt;/b&gt; grid</blockquote>',
    );
    expect(html).not.toContain("<p>&gt;");
    expect(html).not.toContain("<b>evil</b>");
  });
});

describe("compileHelp", () => {
  it("writes a deterministic edition-aware artifact with different same-slug documents", async () => {
    const { root, helpRoot, appRoutesDir } = await createHelpFixture();
    const firstOutput = path.join(root, "first.generated.ts");
    const secondOutput = path.join(root, "second.generated.ts");
    const originalEdition = process.env.VIDYA_EDITION;
    const quiet = { log: vi.fn(), warn: vi.fn() };

    try {
      process.env.VIDYA_EDITION = "school";
      const first = await compileHelp({ helpRoot, appRoutesDir, outputPath: firstOutput, ...quiet });
      process.env.VIDYA_EDITION = "college";
      const second = await compileHelp({ helpRoot, appRoutesDir, outputPath: secondOutput, ...quiet });

      expect(first).toEqual(second);
      const collegeShared = first.college.shared;
      const schoolShared = first.school.shared;
      if (!collegeShared || !schoolShared) {
        throw new Error("Expected both college and school shared fixture documents to be compiled.");
      }

      expect(collegeShared.title).toBe("College guide");
      expect(schoolShared.title).toBe("School guide");
      expect(schoolShared.html).not.toBe(collegeShared.html);
      expect(await readFile(firstOutput, "utf8")).toBe(await readFile(secondOutput, "utf8"));
      expect(await readFile(firstOutput, "utf8")).toContain('export type HelpEdition = "college" | "school";');
    } finally {
      if (originalEdition === undefined) delete process.env.VIDYA_EDITION;
      else process.env.VIDYA_EDITION = originalEdition;
    }
  });
});
