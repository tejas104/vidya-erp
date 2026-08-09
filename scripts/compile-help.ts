import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { helpSlugFor } from "../apps/web/src/ui/help/helpSlug";

/**
 * Compiles content/help/<edition>/*.md into a typed TS module at build time.
 * Why a build step and not a markdown library: ADR-0009 forbids new runtime
 * dependencies. Compiling also lets us emit the "screens with no help doc"
 * warning the assignment requires from the same pass that already knows every
 * route slug and every file on disk — one mechanism, not two.
 *
 * The supported markdown subset is deliberately small and matches what the
 * help docs actually use: h1/h2, ordered and unordered lists, paragraphs,
 * bold, inline code, and > screenshot placeholders. Anything else is escaped
 * and rendered literally rather than silently dropped.
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDITION = process.env.VIDYA_EDITION === "school" ? "school" : "college";
const HELP_DIR = path.join(REPO_ROOT, "content", "help", EDITION);
// The (app) segment is a Next.js route GROUP: it groups files on disk but is
// never part of the URL, so it must never leak into a slug.
const APP_ROUTES_DIR = path.join(REPO_ROOT, "apps", "web", "app", "(app)");
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "ui",
  "help",
  "help-content.generated.ts",
);

// --- HTML escaping ---
//
// Escaping runs on each block's content BEFORE any markup (bold/code/tags)
// is applied to it — a doc can never inject markup. Block *structure*
// (#, ##, >, -, *, 1.) is still detected on the raw line: those marker
// characters aren't HTML-special, so reading them off the raw line first
// and escaping the content after doesn't reopen the escaping requirement —
// it's the only way to detect `> ` at all, since escaping turns it into
// `&gt; ` before any prefix check could see it.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Inline markup, applied to already-escaped text: **bold** and `code`.
function renderInline(rawText: string): string {
  const escaped = escapeHtml(rawText);
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
}

// --- Block-level markdown subset ---

type Block =
  | { kind: "h1" | "h2" | "p" | "blockquote"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

const UNORDERED_ITEM = /^[-*] /;
const ORDERED_ITEM = /^\d+\. /;
const BLOCK_START = /^(#{1,2} |> |[-*] |\d+\. )/;

/** `lines` are raw source lines — nothing here is escaped yet (see above). */
export function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!; // bounds-checked by the while condition
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ kind: "h1", text: line.slice(2) });
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ kind: "h2", text: line.slice(3) });
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({ kind: "blockquote", text: line.slice(2) });
      i++;
      continue;
    }
    if (UNORDERED_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UNORDERED_ITEM.test(lines[i]!)) {
        items.push(lines[i]!.slice(2));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (ORDERED_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && ORDERED_ITEM.test(lines[i]!)) {
        items.push(lines[i]!.replace(ORDERED_ITEM, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // Paragraph: everything else, one block per run of consecutive plain
    // lines (soft-wrapped — joined with a space, matching normal markdown).
    const paraLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !BLOCK_START.test(lines[i]!)) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push({ kind: "p", text: paraLines.join(" ") });
  }
  return blocks;
}

export function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "h1":
          return `<h1>${renderInline(block.text)}</h1>`;
        case "h2":
          return `<h2>${renderInline(block.text)}</h2>`;
        case "p":
          return `<p>${renderInline(block.text)}</p>`;
        case "blockquote":
          // Screenshot placeholder — the only use of `>` in these docs.
          return `<blockquote class="help-screenshot">${renderInline(block.text)}</blockquote>`;
        case "ul":
          return `<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
        case "ol":
          return `<ol>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`;
      }
    })
    .join("\n");
}

export function compileDoc(raw: string): { title: string; html: string } {
  const blocks = parseBlocks(raw.split(/\r?\n/));
  const heading = blocks.find((block) => block.kind === "h1");
  // Title is a plain string (used outside the rendered HTML, e.g. as an
  // aria-label), so it is escaped but not run through inline markup.
  const title = heading && heading.kind === "h1" ? escapeHtml(heading.text) : "Untitled";
  return { title, html: renderBlocks(blocks) };
}

// --- Filesystem ---

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // Edition has no help content yet — zero docs, not an error.
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name));
}

async function listPageFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listPageFiles(fullPath)));
    } else if (entry.name === "page.tsx") {
      results.push(fullPath);
    }
  }
  return results;
}

/** Route group segments, e.g. "(app)", never reach the URL. */
function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function urlPathFor(pageFile: string): string {
  const relative = path.relative(APP_ROUTES_DIR, pageFile);
  const segments = relative
    .split(path.sep)
    .slice(0, -1) // drop "page.tsx"
    .filter((segment) => !isRouteGroup(segment));
  return "/" + segments.join("/");
}

async function main(): Promise<void> {
  const [mdFiles, pageFiles] = await Promise.all([
    listMarkdownFiles(HELP_DIR),
    listPageFiles(APP_ROUTES_DIR),
  ]);

  const docs: Record<string, { title: string; html: string }> = {};
  for (const filePath of mdFiles) {
    const slug = path.basename(filePath, ".md");
    docs[slug] = compileDoc(await readFile(filePath, "utf8"));
  }

  const routeSlugs = new Set(pageFiles.map((file) => helpSlugFor(urlPathFor(file))));
  const missing = [...routeSlugs].filter((slug) => !(slug in docs)).sort();
  if (missing.length > 0) {
    console.warn(`[compile-help] ${missing.length} screen(s) with no help doc: ${missing.join(", ")}`);
  }
  const orphaned = Object.keys(docs).filter((slug) => !routeSlugs.has(slug)).sort();
  if (orphaned.length > 0) {
    console.warn(`[compile-help] ${orphaned.length} help doc(s) with no matching screen: ${orphaned.join(", ")}`);
  }

  const output = [
    "// AUTO-GENERATED by scripts/compile-help.ts — do not edit by hand.",
    "// Regenerate: `npx tsx scripts/compile-help.ts` (also runs via `pnpm compile:help` / `pnpm build`).",
    "",
    `export const HELP_DOCS: Record<string, { title: string; html: string }> = ${JSON.stringify(docs, null, 2)};`,
    "",
  ].join("\n");

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output, "utf8");
  console.log(
    `wrote ${OUTPUT_PATH} (${Object.keys(docs).length} doc(s), edition=${EDITION}, ${routeSlugs.size} route slug(s))`,
  );
}

// Only run when executed directly (`tsx scripts/compile-help.ts`), not when
// imported — the pure functions above are imported by
// scripts/compile-help.test.ts, which must not trigger a real compile pass.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("help compilation failed:", error);
    process.exit(1);
  });
}
