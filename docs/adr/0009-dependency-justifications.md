# ADR-0009: Third-party dependency justifications (Constitution rule 16)

- **Status:** Accepted (living document — every new dependency adds a row
  in its introducing PR)
- **Date:** 2026-07-02

## Runtime dependencies

| Dependency | Where | Justification |
|---|---|---|
| `next` (16.x) | web | Constitution-locked framework (App Router, standalone output). |
| `react`, `react-dom` | web | Required peers of Next; no UI shipped in #1. |
| `pg` | platform | Canonical Postgres driver; pool primitive the migrator and Drizzle share. |
| `drizzle-orm` | platform, modules | Constitution-locked query layer (ADR-0002). |
| `ioredis` | platform | Redis client; BullMQ-compatible connection semantics (`maxRetriesPerRequest: null`). |
| `bullmq` | platform | Constitution-locked job queue (ADR-0003). |
| `@aws-sdk/client-s3` | platform | S3 API client for MinIO/on-prem object storage. |
| `pino` | platform (+ module devDeps for tests) | Constitution-locked structured logging; redaction support. |
| `prom-client` | platform | Constitution-locked Prometheus exposition. |
| `zod` | platform, modules, scripts | Constitution-locked config/input validation; schemas double as OpenAPI source (ADR-0007). |
| `tsx` | worker | Runs TypeScript sources directly (esbuild transform). Type safety is guaranteed by `tsc --noEmit` in CI over exactly these sources; a compile-to-JS step for the worker is recorded as technical debt (docs/review-gate.md), not a correctness gap. |
| `argon2` | module-identity | Native libargon2 binding for the human-owned PasswordHasher (argon2id, ADR-0012). Native reference implementation chosen over pure-JS ports: cost parameters only defend if the hash actually costs that much. |
| `csv-parse` | module-people | Bulk-import CSV parsing (quotes, embedded commas/newlines, BOM). Mature, dependency-free, no native code. Excel `.xlsx` parsing was deliberately rejected (heavyweight parsers with a poor security track record); colleges export CSV from Excel. |
| `pdfkit` | module-reporting | Pure-JS PDF generation for report export (ADR-0021). Chosen over headless Chromium to avoid a ~300MB browser + sandbox + native attack surface on the on-prem worker; uses built-in Helvetica (no font files, no CDN); streams to a Buffer. No postinstall build script. CSV export needs no library (a string builder + the ADR-0020 escape). |

## Development dependencies

| Dependency | Justification |
|---|---|
| `typescript` | The language. Strict mode everywhere. |
| `drizzle-kit` * | Forward-SQL generation from schema diffs (ADR-0008). |
| `vitest`, `@vitest/coverage-v8` | Test runner + coverage gate (ADR-0005). |
| `eslint`, `@eslint/js`, `typescript-eslint` | Lint substrate for the boundary rules. |
| `eslint-plugin-boundaries` | The Constitution rules 1–3 gate (ADR-0006). |
| `eslint-import-resolver-typescript` | Resolves workspace imports so boundaries can classify them. |
| `@asteasolutions/zod-to-openapi` | OpenAPI generation from RouteSpecs (ADR-0007). |
| `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom` | Type declarations. |
| `@types/pdfkit` | pdfkit type declarations (module-reporting; ADR-0021). |
| `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom` | Frontend component tests (#6): render + query + DOM matchers. Pages are pure API consumers, so mocked `api` drives every flow — no browser binary. |
| `jsdom` | DOM environment for the vitest `ui` project (frontend tests run on jsdom, not a real browser). |
| `pino-pretty` | Optional human-readable log formatting in local dev only. |

\* `drizzle-kit` is intentionally **not installed yet**: #1's only migration
was authored directly as SQL (trigger DDL that generators do not emit).
The first schema-diff-generated migration (#2) adds it as a root devDep
under this justification.

## Postinstall build-script approvals (pnpm `allowBuilds`)

| Package | Why it needs a build script |
|---|---|
| `argon2` | Native libargon2 addon; `node-gyp-build` selects a shipped prebuild (or compiles from source) at install. |
| `esbuild` | Downloads its platform binary (tsx, vite/vitest). |
| `msgpackr-extract` | Optional native codec used by BullMQ; falls back to JS if absent. |
| `sharp` | Next.js optional image optimizer binary; unused by API routes but harmless. |
| `unrs-resolver` | Native resolver used by eslint-import-resolver-typescript. |
