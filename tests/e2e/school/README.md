# School-edition journeys

Specs here run ONLY against a server booted with `VIDYA_EDITION=school`:

```
VIDYA_EDITION=school pnpm test:e2e
```

`terms.spec.ts` covers term creation, assessment weight configuration, closure,
audited reopening, the System audit viewer and mobile light/dark rendering.
`marks.spec.ts` provisions a subject teacher, creates an assessment, stores marks,
checks the derived grade, verifies both mobile themes and proves that a closed
term becomes read only. Report cards and weighted aggregate results remain later
work.

For isolated local verification, run the school integration test with
`INTEGRATION_DB_NAME=vidya_codex_school`, then start the production web build with
`VIDYA_EDITION=school` and DATABASE_URL pointing to that database. Set
PLAYWRIGHT_BASE_URL to that server and run the two school specs plus
`tests/e2e/route-coverage.spec.ts`.
The test uses the integration bootstrap account by default; SCHOOL_E2E_USERNAME
and SCHOOL_E2E_PASSWORD can select another authorized school test account.

## Shared-suite fixture boundary

The journeys one level up in `tests/e2e/` are in the SHARED position, so a
school run picks them up too. They have **never been run against a school
server**, and some of them exercise the department level that the school
edition does not have (it keeps exactly one implicit department, which the
school UI never renders — see `IMPLICIT_DEPARTMENT_CODE`). So "shared" is
currently an assumption, not a verified fact.

They remain shared until their college-shaped demo fixtures are separated from
the behavior under test. The release proof therefore runs the complete college
suite, then the two school journeys and edition-aware route inventory against an
isolated school database.

Two specific ones are already known to need triage:

- `../help.spec.ts` — a school build compiles **zero** help docs
  (`content/help/school/` does not exist; measured 2026-09-13, see
  `docs/architecture/editions.md` question 6), so any assertion that a help
  panel has content will fail on school for a content reason, not a code one.
- `../import.spec.ts` — the student CSV columns differ by edition
  (ADR-0023): college sends `department_code,class_code,section_name`,
  school sends `standard_code,section_name`.
