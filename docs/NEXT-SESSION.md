# Vidya ERP — Next-Session Handoff

Paste this whole file into a fresh Claude Code session to continue.
Last updated 2026-09-12. Every number below was observed, not assumed.

---

## You are continuing Project Vidya

An on-prem college ERP sold to Indian colleges: **Next.js App Router**
(`apps/web`) + a modular monolith of `@vidya/module-*` packages, **TS strict,
pnpm, Postgres/Redis/MinIO via Docker**. Branch `feat/a11-onboarding-import`.

### Working agreements (hold these)
- **Ponytail**: smallest change that fully works; reuse before build; **no new
  runtime dependency** (ADR-0009).
- **Real endpoints only** — never hardcode demo numbers into UI. Missing
  endpoint → honest empty/withheld state, and say so.
- **Five states** per screen: loading / empty / error / denied(403) / withheld.
- Both themes from tokens; `:focus-visible`; respect `prefers-reduced-motion`.
- **`packages/modules/identity/src/core/` is human-owned** (PasswordHasher,
  SessionManager, ScopeChecker). Consume the interfaces; never edit the
  implementations. If work seems to require it, STOP and report the interface gap.
- **Verify, don't infer.** This project has been bitten repeatedly by work that
  looked done. A test never seen to fail is not evidence — mutate it and watch
  it go red. Don't grade a module by grepping one file.
- **No screenshot tooling here** — you cannot see the UI. Ask the owner to
  eyeball visual work; never claim visuals are confirmed.

---

## Verified state (2026-09-12)

| Suite | Result |
|---|---|
| `pnpm test` (unit + ui) | **781 passing / 82 files** |
| Integration (real PG + Redis) | **80 passing / 14 files** |
| `pnpm typecheck` | exit 0 |
| `npx eslint .` | 0 problems |
| e2e (76 journeys) | **last green before 2026-09-11's changes — re-run needed** |

## THE ONE BLOCKER: a licence token

The owner's key ceremony is **done** — `packages/platform/src/license/public-key.ts`
holds the real public key (rotated in 0e80d7c; the old placeholder token now
fails as `bad-signature`, confirmed).

The private half is the owner's and is not in this repo, so **a session cannot
issue a licence.** `install.sh` aborts at step 4 without a valid one, so #12
Part 5 (clean-server install) needs the owner to run:

```
npx tsx scripts/license-issue.ts --customer "<name>" --edition college \
  --expires 2027-12-31 --seats 500 --id lic_<id> --key <their secure key path>
```

and hand over the printed token (a token is not a secret — it is signed and
publicly verifiable). **Also: the container images embed the public key at
build time, so they must be rebuilt before any install attempt.**

---

## Run + verify

**Postgres is on 55432, not 5432.** This machine runs native Windows
PostgreSQL services squatting 5432 (PG 14) and 5433 (PG 15). They bind
0.0.0.0 and intercept localhost, so the app reaches THOSE servers, which have
no `vidya` role. `password authentication failed for user "vidya"` means wrong
port, never wrong credentials.

```bash
docker compose -f docker-compose.yml -f docker-compose.altport.yml up -d postgres redis minio

export DATABASE_URL="postgres://vidya:local-dev-only-pg@127.0.0.1:55432/vidya" \
  REDIS_URL="redis://127.0.0.1:6379" S3_ENDPOINT="http://127.0.0.1:9000" \
  S3_REGION="us-east-1" S3_ACCESS_KEY_ID="local-dev-only-minio" \
  S3_SECRET_ACCESS_KEY="local-dev-only-minio-secret" S3_BUCKET="vidya"
```

- **Unit + UI:** `pnpm test`
- **Integration:** `INTEGRATION_RESET_DB=true npx vitest run --project integration --no-file-parallelism`
  Safe by construction now — it targets its own `vidya_integration` database
  (`tests/integration/support/db-url.ts`), never the demo DB.
- **e2e:** needs a **production build AND the worker running**. `next dev` is
  not a valid target — the same suite gave 8 failed / 54 not-run in dev vs 76
  passed on a prod build with zero code changes.
- **Never source `.env` before `next build`** — it sets `NODE_ENV=development`,
  Next emits a dev React build, and the `/manage/marks` prerender dies with
  `Cannot read properties of null (reading 'useContext')`. Build clean; source
  `.env` **plus `NODE_ENV=production`** only to start the server.
- After any route change: `pnpm openapi:generate`.
- Reseed: drop `public` → `npx tsx scripts/migrate.ts up` →
  `VIDYA_ALLOW_DEMO_SEED=true npx tsx scripts/seed-demo.ts`.

---

## Recurring failure modes — check these before trusting green

1. **Composition-root drift.** Adding a required field to a module's `*Deps`
   breaks every composition root, and almost nothing reports it: `next build`
   only compiles `apps/web`, and vitest strips types rather than checking them,
   so the integration harness happily builds a module with a required dep
   `undefined`. **Only `pnpm typecheck` (whole workspace) sees it, and nothing
   gates on it.** Happened three times.
2. **Missing `route.ts`.** A RouteSpec with no `app/api/.../route.ts` gives
   green unit tests and a 404 endpoint. Happened three times. A zero-infra
   route-coverage unit test now guards it — keep it passing.
3. **Stale docs that assert working features are broken** (and vice versa).
   Several have been found. Fix the doc in the same commit.
4. **Docker collapses at low RAM** (this host: ~0.5–1 GB free of 15.7). Heavy
   image builds and a Next prod build cannot run concurrently.
5. **`docker compose` port lists MERGE across overlay files** — the altport
   override adds 55432, it does not replace 5432.
6. **node-postgres parses a bare `date` column into a JS Date at LOCAL
   midnight** — raw SQL against a date column needs `::text` or it reads a day
   early east of UTC. Drizzle `mode: "string"` protects the production path.
7. **Never FLUSHDB** — it wipes BullMQ under a running worker and jobs silently
   stop being consumed. Clear only `ratelimit:*` / `idn:throttle:*`.

---

## Recently landed (2026-09-08 → 09-12)

- **Licensing complete on the verification side.** Ed25519 offline verifier,
  issuing/verifying CLI, admin banner + System-page details, editions, and all
  three owner rulings: DECISION 1 (banner only, nothing ever blocked),
  **DECISION 2** (high-water clock mark — `sys_clock_watermark`, audits
  `system.clock-rollback`, evaluates the licence at the mark, one-day NTP
  tolerance), **DECISION 3** (`system.seat-overage`, once per boot, never
  enforces). Both mutation-proven.
- **Licence reached no container.** `install.sh` verified a licence then wrote
  only a host path; `VIDYA_LICENSE` stayed empty so every install booted
  `absent` and the whole licence UI was dead in production. Fixed (11b11bd);
  `update.sh` backfills, healing installs already in the field.
- **Release bundle leak closed** — 1,310 entries / 822 MB → 20 / 38 KB, with a
  build-time guard proven by firing.
- ESLint 43 → 0. Workspace typecheck restored (6 drifted call sites).
- Account lockout re-keyed proof: username-only, mutation-proven at unit level
  and verified against real Redis.
- `docs/architecture/editions.md` written (#13 precondition).

---

## What's open, in priority order

1. **Re-run e2e** against the current tree — six `manage/*` pages, the System
   page's data path (`license` became a getter), and the boot sequence all
   changed on 09-11. Unit and integration are green but neither drives a browser.
2. **#12 Part 5** — clean-environment install: install.sh end-to-end → HTTPS →
   login → demo CSV import → attendance → fee-receipt PDF; then a version-bump
   `update.sh`; then a deliberate health-check break → rollback; plus the
   wrong-edition refusal **through the CLI boundary**. Needs the token above and
   an image rebuild. Nothing about the bundle has ever been watched to install.
3. **Nobody can read the audit log.** `system.clock-rollback`,
   `system.seat-overage`, login failures and lockouts all write rows that no UI
   surfaces — there is no operational view short of SQL. Read paths already
   exist (`readRecentAuditEvents`, `readAuditEventsByAction`,
   `readAuditEventsForResource`); what is missing is a route + an admin page.
4. **#13 editions** — blocked on a PRODUCT decision, not engineering:
   `editions.md` found that **edition currently decides nothing.** The only code
   branching on it returns identical CSV columns for both editions, and
   `content/help/school/` does not exist. Decide what a school edition IS before
   writing the assignment, or the work becomes invention.
5. **`{message}` vs `problemSchema` response mismatch** — 84 occurrences across
   all 15 modules. Pre-existing, mechanical, deferred twice.
6. **Vendor-side licensing operations** (not built, never specced): no record of
   what was issued to whom, no renewal/expiry tracking, no reissue workflow. The
   verifier is done; the business process around it is not. Owner's call whether
   this is a product feature or a spreadsheet.

## Gotchas

- Memory: `~/.claude/projects/D--ATLAS/memory/` — read `MEMORY.md` first.
- `.env` sets port 5432 and `.claude/launch.json` sources it — a footgun given
  the native-PG squat above.
- Three orphaned full-repo copies under `.claude/worktrees/` (not registered
  worktrees, no `.git`). ESLint now ignores them; they are otherwise dead.
- Out of scope by owner ruling: username scoping for multi-college installs
  (admission numbers unique per college, usernames globally unique — a collision
  silently skips a student).
