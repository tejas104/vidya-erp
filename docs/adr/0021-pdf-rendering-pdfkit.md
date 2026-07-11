# ADR-0021: PDF rendering with pdfkit (no headless browser)

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

#6 exports reports as PDF and CSV. CSV is a pure string builder (ADR-0020's
escaping is the only subtlety). PDF needs a renderer. The dominant options:

1. **Headless Chromium** (Puppeteer/Playwright → print-to-PDF). Pixel-perfect
   HTML/CSS, but ships a ~300MB browser, needs sandbox flags and extra OS
   libraries in the container, is a large and actively-exploited attack
   surface, and is heavy to run inside a BullMQ worker on an on-prem box.
2. **A native library** (wkhtmltopdf, etc.) — unmaintained, native build,
   similar footprint concerns.
3. **A pure-JS PDF library** (pdfkit) — programmatic drawing, no browser, no
   native code, streams to a Buffer.

## Decision

Use **pdfkit** for PDF generation in the reporting worker.

- **Pure JS, no Chromium, no native addon.** Nothing to sandbox, no browser
  CVE surface, no extra base-image libraries — it fits the on-prem, offline
  posture (the same reasoning that self-hosts fonts in ADR-0019 and rejects
  heavyweight `.xlsx` parsers in ADR-0009).
- **Built-in Helvetica** (a standard PDF base-14 font) — no font files to
  ship, no runtime CDN. The report layout is deliberately typographic and
  monochrome; it does not need the dashboard's display faces.
- **Streaming to a Buffer.** `renderPdf` collects the document stream into a
  `Buffer` and hands it to the object store; the worker never touches the
  filesystem.
- The binary flows back through the existing `defineRoute` pipeline: the
  download handler returns a `Uint8Array` body with
  `Content-Type: application/octet-stream` and a `Content-Disposition`
  attachment filename — the one place the text-oriented response path carries
  bytes (a small, reviewed addition to `toResponse`).

## Consequences

- Layout is code, not HTML/CSS — fine for a fixed, tabular report; a report
  *designer* (arbitrary templates) would revisit this, but that is out of #6's
  scope (and out of the MVP by the assignment's deferral list).
- `renderPdf` is integration-tested (the flow asserts a real `%PDF-` artifact
  is produced and downloaded) and **excluded from unit line-coverage** — it is
  imperative drawing with no branching logic to gate; the security-critical
  code (`escape-csv.ts`, `report-service.ts` access checks) keeps its 100%/95%
  gates. See ADR-0005's coverage-policy amendment.
- Dependencies `pdfkit` + `@types/pdfkit` are justified in ADR-0009; pdfkit
  has no postinstall build script (no `allowBuilds` entry needed).
