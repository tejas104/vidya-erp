# Editions

What an "edition" is in this codebase **today**. Every mechanism claim below
cites `file:line`. Anything not cited does not exist; anything undecided is in
[Open questions for the owner](#open-questions-for-the-owner) as a question,
not an answer.

## 1. What an edition is

Two things that must agree:

1. A signed claim in the licence token — `edition: "college" | "school"`
   (`packages/platform/src/license/verify.ts:18`, `:24`), a **required** claim
   that never defaults or wildcards
   (`packages/platform/src/license/verify.ts:153-160`; spec ruling at
   `docs/superpowers/specs/2026-08-13-license-verification-design.md:39`).
2. The `VIDYA_EDITION` environment variable, a strict enum
   (`packages/platform/src/config/env.ts:132`) surfaced as `config.edition`
   (`packages/platform/src/config/env.ts:203`, `:301`). An unknown value fails
   config validation and the process does not boot
   (`packages/platform/src/config/env.test.ts:149`).

If the claim and the env var disagree, the licence resolves to
`{ kind: "invalid", reason: "edition-mismatch" }`
(`packages/platform/src/license/verify.ts:194-196`). The mismatch is checked
*after* the signature verifies, so it is reported distinctly from
`bad-signature` — a cryptographically genuine licence for the wrong edition
(`packages/platform/src/license/verify.ts:31-36`, `:191-196`).

## 2. The mechanism, end to end

**Issued.** `scripts/license-issue.ts` requires `--edition college|school`
(`scripts/license-issue.ts:57`, `:68-69`) and signs it into the payload
(`scripts/license-issue.ts:96`). `--verify <token>` re-checks a token, against
both editions unless `--edition` narrows it
(`scripts/license-issue.ts:45-52`).

**Chosen at install.** `install.sh` prompts until the answer is exactly
`college` or `school` (`install.sh:154-157`) and writes it to `.env` once
(`install.sh:165`); a re-run with `SITE_ADDRESS`/`VIDYA_EDITION`/`ACME_EMAIL`
already present skips the prompts (`install.sh:137-141`).

**Verified at install, in a container.** Step 4 runs
`scripts/license-issue.ts --verify` inside a throwaway container off the worker
image (`install.sh:246-262`) and branches on the parsed `kind`
(`install.sh:278-306`). `edition-mismatch` re-verifies against the other
edition purely to name it in the error, then aborts the install
(`install.sh:293-297`). `absent` and other `invalid` reasons also abort
(`install.sh:288-300`); `expired` only warns (`install.sh:283-286`).

**Re-checked at update.** `update.sh` step 3 re-verifies the on-file licence
against `.env`'s `VIDYA_EDITION` (`update.sh:95-101`). It refuses the update on
`edition-mismatch` (`update.sh:112`) and on `expired` past grace
(`update.sh:119`), and fails *open* on an unparseable verifier output
(`update.sh:125`). This gates the vendor-performed update only — never app
usage (`update.sh:87-94`).

**Reaching the container.** `docker-compose.yml` enumerates its environment
under the `&app-env` anchor (`docker-compose.yml:78`) and the worker reuses it
(`docker-compose.yml:135`). The documented footgun is on
`docker-compose.yml:93-99`: this service does **not** use `env_file`, so a
variable written into `.env` reaches compose only for `${...}` interpolation
and does not reach the container unless it is listed. `VIDYA_EDITION`,
`VIDYA_LICENSE` and `VIDYA_LICENSE_FILE` are therefore listed explicitly
(`docker-compose.yml:100-102`).

**Read at boot.** `apps/web/src/composition.ts:83-97` reads the token —
`VIDYA_LICENSE` inline wins, else `VIDYA_LICENSE_FILE` is read from disk, and
anything missing or unreadable becomes `""`, which verifies as `absent` rather
than a boot failure. `verifyLicense(token, LICENSE_PUBLIC_KEY, new Date(),
config.edition)` runs **once** (`apps/web/src/composition.ts:142`); the result
is stored on the runtime (`apps/web/src/composition.ts:76`, `:434`) and one
`system.license-check` audit event is written
(`apps/web/src/composition.ts:163-179`). The worker never verifies: it
hardcodes `license: { kind: "absent" }`
(`apps/worker/src/main.ts:122-124`).

**Surfaced.** `GET /api/v1/system/license` returns the status plus active
student count, staff-only, presentation-only by its own contract
(`packages/modules/system/src/definition.ts:59-99`;
`packages/modules/system/src/api/handlers.ts:120-123`). The admin System page
renders customer/edition/expiry/seats
(`apps/web/app/(app)/manage/system/page.tsx:21-57`). `LicenseBanner` shows
≤30 days to admins, ≤7 days to all staff, and expired/invalid/absent to admins
only (`apps/web/src/ui/LicenseBanner.tsx:38-75`, `:97`) — every message says
in so many words that nothing stops working
(`apps/web/src/ui/LicenseBanner.tsx:45`, `:53`, `:59`).

## 3. What an edition does NOT do

- **It gates no feature at runtime.** Per DECISION 1
  (`docs/superpowers/specs/2026-08-13-license-verification-design.md:62-64`),
  expiry blocks nothing: banner only, no write-blocking, no degraded mode. The
  verifier says so about itself
  (`packages/platform/src/license/verify.ts:6-11`), the composition root says
  so (`apps/web/src/composition.ts:134-141`), and the route contract says so
  (`packages/modules/system/src/definition.ts:53-58`). `grace` vs `expired` is
  a wording bucket, not a window
  (`packages/platform/src/license/verify.ts:48-57`).
- **`edition-mismatch` does not stop the app either.** It aborts `install.sh`
  and `update.sh` (§2) but in a running container it only produces an admin
  banner reading "Licence problem (edition-mismatch)"
  (`apps/web/src/ui/LicenseBanner.tsx:56-60`). The app serves normally on the
  env var's edition.
- **Almost nothing branches on edition.** Repo-wide, `config.edition` has
  exactly two consumers:
  - CSV import template headers — and the switch currently returns the *same*
    columns for both editions
    (`packages/modules/people/src/api/handlers.ts:137-143`, used at `:149` and
    `:1001`). The comment at `:129-135` states plainly that college and school
    share one org-tree shape today and the switch is a seam, not a difference.
  - The help-content directory, chosen at **build** time from
    `process.env.VIDYA_EDITION` by `scripts/compile-help.ts:20-21`. Only
    `content/help/college/` exists on disk; there is no `content/help/school/`.

  That is the whole list. No routes, roles, schemas, modules, menus, or
  validation rules branch on edition.
- **All three spec decisions are now implemented** (DECISION 2 and 3 landed in
  8132da2). The high-water clock mark lives in
  `packages/modules/system/src/service/clock-watermark.ts` behind a single-row
  `sys_clock_watermark` table, and the seat-overage audit in
  `packages/modules/system/src/service/seat-usage.ts`; the composition root
  runs both once per boot. Neither gates anything — DECISION 1 still holds,
  and nothing in the licence path blocks a request.
- **The public key is a placeholder.** No licence has ever been issued against
  it; it must be rotated before the first real release
  (`packages/platform/src/license/public-key.ts:12-19`).

## 4. The default trap

`VIDYA_EDITION` is **not required**. It defaults to `"college"`
(`packages/platform/src/config/env.ts:132`) — verified still true, along with
the test that pins the default's sibling behaviour
(`packages/platform/src/config/env.test.ts:145-149`). Compose repeats the
default at the interpolation layer: `${VIDYA_EDITION:-college}`
(`docker-compose.yml:100`). The people module repeats it a third time —
`edition: deps.edition ?? "college"`
(`packages/modules/people/src/index.ts:204`), which is what the worker gets,
since `apps/worker/src/main.ts:158-169` passes no `edition` at all.

So a school install that fails to pass the variable through runs silently as a
college install. There is no boot warning and no runtime error — the only
signal is that a `school` licence then reads as `edition-mismatch`
(`packages/platform/src/license/verify.ts:194-196`), and only if a licence
actually reached the container. `docker-compose.yml:97-99` documents exactly
this failure.

**A live contradiction to resolve.** `install.sh:442-449` prints a "KNOWN GAP"
telling the operator that `docker-compose.yml` does not pass `VIDYA_EDITION` or
`VIDYA_LICENSE`/`VIDYA_LICENSE_FILE` into the containers. Compose does pass all
three (`docker-compose.yml:100-102`), so that block is stale for edition — but
the licence half is still effectively true by a different route: `install.sh`
writes only `VIDYA_LICENSE_PATH` (`install.sh:307`), which `.env.template:172-180`
says is host-side bookkeeping for `update.sh` and is **not read by the app**.
Nothing in `install.sh` sets `VIDYA_LICENSE` or `VIDYA_LICENSE_FILE`, and
`docker-compose.yml` mounts no licence file (the only volumes are `pg-data` and
`minio-data`, `docker-compose.yml:148-150`). A stock install therefore boots
with an **absent** licence in the container even though step 4 verified a real
one — while `.env.template:166-169` claims install.sh mounts the file
automatically. One of those three is wrong.

## Open questions for the owner

> **ANSWERED 2026-09-12 (question 1).** The school edition's tree is
> school → standard → section, built on the existing four-level tree with one
> implicit department — see [ADR-0023](../adr/0023-school-edition-org-tree.md).
> Module-level gating now exists (`ModuleDefinition.editions` +
> `moduleRunsOnEdition`, runtime, at the composition root), and the e2e suite
> splits into a college and a school run (`playwright.config.ts`). Questions
> 2–4, 6 and 7 below are unchanged; question 5 is answered on the read-path
> side only (`GET /api/v1/system/audit` exists; no UI consumes it yet).

1. ~~**What is actually supposed to differ between `college` and `school`?**~~
   **ANSWERED — see the note above and ADR-0023.** Original finding, kept for
   the record:
   Today: nothing but CSV header text that is currently identical
   (`packages/modules/people/src/api/handlers.ts:137-143`) and a help-content
   directory that exists for only one of the two editions. Is the school
   edition a different org tree (school → grade → section), a different feature
   set, the same product with different vocabulary, or only a licensing/pricing
   label?
2. **Should `VIDYA_EDITION` keep defaulting to `college`, or become required?**
   Making it required turns §4's silent wrong-edition install into a boot
   failure, at the cost of breaking any deployment relying on the default.
3. **Should a container running with `edition-mismatch` do anything beyond
   showing a banner?** DECISION 1 rules out blocking on expiry; it does not say
   whether a wrong-edition licence is the same class of event.
4. **How is the licence meant to reach the container?** Inline
   `VIDYA_LICENSE`, a mounted file plus `VIDYA_LICENSE_FILE`, or should
   `install.sh` derive one from `VIDYA_LICENSE_PATH`? Until this is answered,
   the System page and banner show "absent" on a correctly licensed install
   (§4).
5. **Is a `system.clock-rollback` or `system.seat-overage` audit row meant to
   surface anywhere a human looks?** Both are written once per boot (8132da2)
   but nothing reads them back — there is no operational view of the audit log
   short of SQL, so a rollback is recorded and then silent.
6. **Does `content/help/school/` need to exist before a school install is
   possible?** **No — measured 2026-09-13.** `listMarkdownFiles`
   (`scripts/compile-help.ts:158-168`) treats a missing directory as "zero
   docs, not an error", so a school build succeeds. Observed by running it:

   ```
   VIDYA_EDITION=school npx tsx scripts/compile-help.ts
   [compile-help] 29 screen(s) with no help doc: analytics, attendance, ...
   wrote help-content.generated.ts (0 doc(s), edition=school, 29 route slug(s))
   ```

   versus 15 docs on college. So a school install *works* and ships with **no
   help at all**. That is a content gap for the owner, not an engineering
   blocker — writing the school help docs is authoring work and is
   deliberately not invented here.

   Still open, and unchanged by the above: help is chosen at BUILD time while
   module gating (#13) is now a RUNTIME decision, so "edition" remains partly
   a build property. One image can serve both editions in every respect
   except help content. Is one image per edition intended, or should help
   move to a runtime lookup?
7. **When must the placeholder signing key be rotated**
   (`packages/platform/src/license/public-key.ts:12-19`), and who holds the
   private half?
