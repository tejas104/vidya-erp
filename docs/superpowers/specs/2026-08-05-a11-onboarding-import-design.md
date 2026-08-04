# Assignment #11 — Onboarding, help, CSV import & credential distribution

**Base:** `feat/a10-remainder-a105-security` @ `c91be43` (#10 + #10.5 complete, e2e 26/26).
**Branch:** `feat/a11-onboarding-import`.

## Precondition & constraint

#10 complete and the full suite green — both hold. #11 adds two backend capabilities
(CSV import extension, credential generation); everything else is UI and content. All
new endpoints scope-check through the shared platform `ScopeChecker`.
`PasswordHasher` / `SessionManager` / `ScopeChecker` **implementations**
(`packages/modules/identity/src/core/`) stay human-owned — interfaces only.

## Findings (recorded, not worked around)

Established by pre-flight against the real tree, before any design choice.

1. **STOP 1 confirmed — no temp-password issuance.** `core/contracts.ts:23-36` exposes
   `dummyHash` / `hash` / `verify` / `needsRehash`. Nothing generates a password.
2. **STOP 2 confirmed, and inverted from what Part 2 needs.** `must_reset` exists
   (`users-repo.ts:6`, set by `users-service.createUser`) but `auth-service.login:178`
   **rejects** it — the temp password cannot log in at all. A force-change-flagged
   account and your e2e guard (b) ("a new student can log in with a generated
   credential") were mutually exclusive. `users-service.adminSetPassword` says so
   directly: "a change-on-next-login cannot be forced without changing that
   choreography (deferred, human-owned)".
3. **Part 1 is largely built.** `people.import-create` / `people.import-get`
   (`people/src/definition.ts:639,668`) already cover **students and teachers**, a
   `dryRun` validation pass, the `bulk-import` BullMQ job, per-row errors, ADMIN_ONLY
   auth, and `UPLOAD_BODY_MAX_BYTES`. Service, job, repo and a `/manage/import` screen
   all exist.
4. **Idempotency is already satisfied.** `import-service.ts:232-238` looks up existing
   admission numbers and pushes a **row-level error** rather than updating — so
   re-uploading a file yields all-errors and zero duplicates, which is exactly the
   "collisions become row-level errors, never silent updates" rule. Same for staff
   numbers (`:314-319`). In-file duplicates are caught separately (`:202`).
5. **No edition concept exists.** Confirmed repo-wide; S2a already hit this and recorded
   "Editions are N/A until introduced (not invented in S2a)". #11 introduces it.
6. **`PageHeader` already exists and is already adopted on 26 of 28 pages.**
   `packages/ui-system/src/PageHeader/PageHeader.tsx` — props `title`, `breadcrumb`,
   `eyebrow`, `lede`, `actions`. **This corrects an earlier pre-flight error**: the first
   search covered only `apps/web/src` and missed the `packages/ui-system` package
   entirely, which made D4 look like a 28-page refactor. It is not. The real work is a
   help affordance on the existing component plus adoption on the only two holdouts,
   `app/(app)/manage/classes/page.tsx` and `app/(app)/students/[studentId]/page.tsx`.
   `SlideOver` also already exists in the same package — Part 3 reuses it, not builds it.
7. **No user-preferences mechanism.** The system module is health/ready/metrics only and
   has **no `migrations/` directory** — Part 4 adds its first.
8. **No markdown renderer, and ADR-0009 forbids new runtime deps.**

## Decisions (locked with the owner)

| # | Decision | Consequence |
|---|---|---|
| D1 | Temp passwords come from a **new platform utility** using `node:crypto`, outside identity `core/` | Unblocks Part 2 now. Recorded as an owner-ratified deviation: generating a random string is not hashing and has no tunable parameter that can be subtly wrong |
| D2 | **Ship credentials active now, plan the login-flow change separately** | Students can log in (guard (b) passes); no force-change flag. The choreography change is carved out as its own owner-signed-off assignment, not smuggled into #11 |
| D3 | **Introduce a real edition config** (`college` \| `school`) | Template headers and help paths key off it. #11 is its first and only consumer |
| D4 | **`PageHeader` everywhere, with the help affordance on it** | Chosen as "new component, all 28 screens", but finding 6 shows the component exists and 26 pages already use it. The decision's *intent* — one header everywhere, help reachable from it — is honoured at a fraction of the cost: add the affordance to the existing component, convert the two holdouts |

## Goal

An admin can take a college from empty to operating: import students and staff from CSV
with a preview they can trust, hand every student working credentials on a printed sheet,
and find in-app help on any screen — with a first-run checklist that says what to do next.

## Phasing

Three phases. Phase 1 is sequential and alone because D4 touches all 28 pages and would
collide with every concurrent screen change.

**Phase 1 — foundations (one track, no parallelism).**
Edition config · `helpSlug` on the existing `PageHeader` + the two holdout conversions ·
help SlideOver plumbing (reusing the existing `SlideOver`) and its "no help yet" state ·
the build-time help compiler.

**Phase 2 — two tracks, disjoint trees, safe in parallel.**

| | Track A | Track B |
|---|---|---|
| Owns | `packages/modules/people/**`, import screens | `packages/platform/src/credentials/**`, `packages/modules/identity/src/service/**`, `packages/modules/reporting/**` |
| Delivers | Part 1 + e2e guard (a) | Part 2 + e2e guard (b) |

**Phase 3 — two halves, also parallel.**
Help content (15 docs) + guard (c) · onboarding checklists, preferences table + guard (d).

## Components (isolated, testable)

**`platform/src/credentials/temp-password.ts`** — `generateTemporaryPassword()`.
`node:crypto.randomBytes`, unambiguous alphabet (no `0` `O` `1` `l` `I`), documented
length and entropy, rejection sampling so the alphabet stays uniform. One self-check
asserting charset, length and non-repetition across many draws. No other responsibility.

**`identity/src/service/credential-service.ts`** — issues a login for a person who lacks
one: create the account, then set it active through the existing `adminSetPassword` path
(D2). Returns `{ username, temporaryPassword }` **once**, never persisted in plaintext,
never logged, never audited. Consumes `PasswordHasher` through its interface only.

**`people` import extension** — four additions to code that already works:
- `GET /api/v1/people/imports/template?kind=` → `text/csv`. Server-side so headers are
  edition-aware and the route is covered by `route-coverage.spec.ts`.
- `GET /api/v1/people/imports/{id}/errors.csv` → rejected rows with reasons. Reuses
  reporting's existing `escape-csv.ts` so CSV-injection safety is not re-solved.
- A **warning** tier alongside ok/error: a row that imports *with a caveat* — e.g. a
  student created unassigned because the optional enrollment columns were blank. Errors
  block a row; warnings do not.
- Progress counters (`processed` / `total`) on the import record, updated by the job.

**`ui-system/PageHeader`** (existing, extended) — gains one optional `helpSlug` prop that
renders the "?" button. When omitted the header renders exactly as it does today, so all
26 current call sites are untouched by the change. The two holdout pages convert to it.

**Help compiler (build step)** — walks `content/help/{edition}/*.md`, emits a typed
module the app imports, and **warns listing every route slug with no doc**. One mechanism
covers both the no-runtime-dep constraint (finding 8) and the spec's build-warning
requirement; there is no second code path for the warning.

**`system` preferences** — first migration for the module:

```sql
CREATE TABLE sys_user_preferences (
  user_id    uuid NOT NULL,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
```

Keyed, not columned, so a second preference never needs a migration. Read/write scoped to
the caller's own `user_id` — a user cannot address another user's preferences.

**Onboarding checklist** — per-role card, dismissible, state in the table above. Items
auto-check where completion is derivable from existing data (students exist ⇒ import
done); otherwise manual.

## Data flow — import preview → confirm

Upload → `POST imports {dryRun:true}` → poll `import-get` → preview table renders per-row
ok/warning/error → admin confirms → `POST imports {dryRun:false}` with the same CSV → job
runs → summary + `errors.csv` download.

Two import records per file, deliberately: the dry run is a real, auditable artifact
rather than hidden client state, and the confirm pass re-validates against a database
that may have changed between preview and confirm.

## Error / empty / loading

Every new screen carries the project's five states — loading, empty, error, denied (403),
withheld. A failed fetch renders an **error** state, never an empty one; #10's review
found three places that collapsed the two and this spec does not add a fourth.

## Testing

Unit: temp-password charset/length/uniformity; import warning classification; help-slug
derivation from route; preference scoping (a user cannot read another's key).
UI: PageHeader renders and the "?" opens the SlideOver; checklist auto-check logic.
E2E (Part 5): (a) 20 valid + 3 invalid rows → preview flags exactly 3 → confirm → 21
students, re-upload adds none, error CSV downloads; (b) credential sheet PDF generates
and a new student logs in with a generated credential; (c) help SlideOver opens with real
content on the attendance screen; (d) admin checklist renders and items deep-link.

## Verification (exit criteria)

E2E output with all prior journeys green · the `bulk-import` completion log · the
generated credential PDF attached · the list of 15 help docs · `git diff --stat` · and an
explicit statement of both STOP conditions hit (findings 1 and 2) with zero changes under
`packages/modules/identity/src/core/`.

## Out of scope

Hindi/Marathi translation of help content (flagged future work) · the login-choreography
change enabling true force-change-on-first-login (D2, its own assignment) · true
multipart streaming upload (see Risks) · a second edition's content.

## Risks

1. **The credential sheet is plaintext passwords in object storage.** The reporting
   module uploads artifacts to MinIO, so this is a durable, re-downloadable list of
   working credentials. Mitigation: admin-only generation, audited, documented in
   `SECURITY.md` as a known-sensitive artifact with short retention recommended. Raised
   with the owner; stronger options (never persisting it) remain open.
2. **Largely retired by finding 6.** Only two pages change structurally, plus one new
   button inside the shared `PageHeader`. Mitigation still stands where it applies:
   heading text and test-visible attributes stay byte-stable on those two pages, and the
   26 existing journeys must be green at every task boundary, as in #10.
3. **"Streaming parse for 5,000 rows" is solving a load that does not exist.** 5,000 rows
   is roughly 400KB against an existing 1,000,000-char limit. Plan: measure and report
   the true ceiling rather than build multipart streaming. If the measured ceiling falls
   short of 5,000 rows, escalate rather than silently accept it.
4. **Edition config has exactly one consumer.** Nothing else in the app is
   edition-aware, so the abstraction is unproven until a school install exists.
