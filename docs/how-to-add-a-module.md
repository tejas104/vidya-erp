# How to add a feature module

The system module (`packages/modules/system`) is the living reference for
everything below. A module is a pnpm workspace package that owns its
routes, tables, migrations, jobs and public service API — and exposes
exactly one import surface: `src/index.ts`.

## 1. Create the package

```
packages/modules/<name>/
├─ package.json          name "@vidya/module-<name>";
│                        exports: { ".": "./src/index.ts", "./package.json": "./package.json" }
│                        deps: "@vidya/platform": "workspace:*", drizzle-orm, zod
├─ tsconfig.json         extends ../../../tsconfig.base.json
├─ migrations/           NNNN_name.sql + NNNN_name.down.sql (pairs are mandatory)
└─ src/
   ├─ index.ts           THE public API — definition + create<Name>Module + service type
   ├─ definition.ts      static ModuleDefinition (routes, jobs, tablePrefix, migrationsDir)
   ├─ api/               route handlers (internal)
   ├─ service/           business logic + public service implementation (internal)
   ├─ jobs/              job processors (internal)
   └─ db/schema.ts       Drizzle tables — ALL names start with your prefix (internal)
```

## 2. Fill the contract (`VidyaModule`, platform `contracts/module.ts`)

- **`tablePrefix`** — pick a short unique prefix (`att_`, `idn_` …);
  `pnpm check:ownership` enforces it against your SQL and `pgTable()` calls.
- **RouteSpecs** — versioned path `/api/v1/<name>/…`; zod schemas for
  query/body/responses (they become the OpenAPI spec); `auth` is
  `{ public: false, requirement: { rolesAnyOf/scopesAllOf } }` unless you
  can justify `public` in writing; state-changing methods must declare
  `audit: { action, resourceType }` — `defineRoute` refuses otherwise.
- **JobSpecs** — job name + zod payload schema; your queue is your module
  name.
- **Factory** — `create<Name>Module(deps)` receives what it needs
  (db, metrics, other modules' *services*) and returns
  `{ definition, handlers, jobProcessors, readinessChecks, service }`.
  Call `assertModuleWiring(module)` in the factory like system does.
- Copy `definition.test.ts` from system and keep its conformance
  assertions (versioned paths, unique ids, justified public routes,
  audited mutations).

## 3. Register in exactly three places

1. **`scripts/registry.ts`** — add your `ModuleDefinition` (enables
   migrations, OpenAPI, ownership check).
2. **`apps/web/src/composition.ts`** — instantiate via your factory, add to
   `modules`; then add one thin route file per route under
   `apps/web/app/api/v1/<name>/…/route.ts`:
   ```ts
   import { routeHandler } from "@/composition";
   export const dynamic = "force-dynamic";
   export const runtime = "nodejs";
   export const GET = routeHandler("<name>.<route>");
   ```
   (Route files may import nothing else — lint enforces it.)
3. **`apps/worker/src/main.ts`** — add to `modules` if you declare jobs.

## 4. Wire cross-module needs through services

Need audit? It's injected into the pipeline already. Need another module's
data? Take its **service interface** in your factory deps (composition
root passes it). Never import its internals or touch its tables — the
build fails.

## 5. Verify

```
pnpm typecheck && pnpm lint && pnpm test
pnpm check:ownership
pnpm openapi:generate        # commit the diff
pnpm db:migrate && pnpm db:rollback && pnpm db:migrate   # against dev db
```

Add integration tests under `tests/integration/` for anything touching
Postgres/Redis. New third-party dependency? Add its justification row to
ADR-0009 in the same PR. New security-sensitive surface? Extend
docs/threat-model.md and respect the coverage policy
(docs/security-review.md#coverage-policy).
