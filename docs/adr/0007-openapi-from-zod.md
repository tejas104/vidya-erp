# ADR-0007: OpenAPI generated from RouteSpecs (@asteasolutions/zod-to-openapi)

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Rule 6 requires public routes to be marked in the OpenAPI spec; a
hand-written spec drifts from enforcement.

## Decision

Every module declares `RouteSpec`s carrying the same zod schemas the
`defineRoute` pipeline enforces at runtime, plus the auth declaration
(public-with-reason, or required-with-role/scope requirement).
`scripts/generate-openapi.ts` renders these into
`docs/openapi/openapi.json` via `@asteasolutions/zod-to-openapi`
(committed artifact); CI runs `--check` and fails when it is stale.
Auth posture is embedded per route: public routes carry their recorded
justification, authenticated routes reference the `sessionAuth` security
scheme (contract now, implementation in #2) and document the interim 401.

## Alternatives considered

- Hand-authored YAML: drifts silently; double bookkeeping.
- Runtime-served spec endpoint: fine later; a committed artifact is
  reviewable in PRs and needs no running app.

## Consequences

- The spec cannot describe behavior the pipeline doesn't enforce — they
  share the schema objects.
- Adding a route without updating the spec fails CI (regenerate + commit).
