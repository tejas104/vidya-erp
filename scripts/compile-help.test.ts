import { describe, expect, it } from "vitest";
import { compileDoc } from "./compile-help";

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
